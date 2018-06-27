import fs from 'fs';
import path from 'path';
import { DEFAULT_ID_ATTR, DEFAULT_PLURAL_ATTR, DEFAULT_FIELDS_ATTR } from './constants';
import { createGlobalLinebreakMatcher } from 'eslint/lib/ast-utils';

const LINE_BREAK_GLOBAL_MATCHER = createGlobalLinebreakMatcher();

/**
 * Determine whether a given node contains text that is non-empty after trimming whitespace/newlines
 * and does not match the ignoreTextRE regex and is not in the subtree of a node matching markupNodeNameRE regex
 * @param {Object} node
 * @param {RegExp} [ignoreTextRE]
 * @param {RegExp} [markupNodeNameRE]
 * @returns {String} The offending text if the text should is not allowed, undefined if it is OK
 */
export const isDisallowedTextNode = ({ node, parent={}, ignoreTextRE, markupTextComponents }) => {
	//Catch string JSX expressions like <span>{"foo"}</span>
	if (node.type === 'JSXExpressionContainer') {
		node = node.expression;
	}

	let text = node.type === 'Literal' && node.value && node.value.replace && node.value.replace(LINE_BREAK_GLOBAL_MATCHER, '').trim();
	if (!text || ignoreTextRE && ignoreTextRE.test(text)) return;

	// If no regular expression is defined, then this text is not allowed regardless of its ancestry nodes
	if (!markupTextComponents) return text;

	//verify the offending node is not contained within an i18n tag that allows markup for fallback
	let current = { parent };
	while ((current = current.parent)) {
		if (current.type === 'JSXElement' && getI18NComponent({ node: current, components: markupTextComponents })) {
			return;
		}
	}

	return text;
};

/**
 *
 * @param {Object} object
 * @param {Array} keys Ordered array of keys to fetch at each depth on the object
 * @param {*} index
 */
const recursiveGet = (object, keys, index) => {
	if (keys.length - index === 1) {
		return object[keys[index]];
	}

	return typeof object[keys[index]] === 'object' ? recursiveGet(object[keys[index]], keys, index + 1) : undefined;
};

/**
 * @private
 *
 * Determine if the dot-notated key exists and has a truthy value on object
 *
 * @param {Object} object
 * @param {String} key
 *
 * @example has({a: {b: 'foo'}}, 'a.b') === true
 * @example has({a: {b: ''}}, 'a.b') === false
 * @example has({a: {b: 'foo'}}, 'a.buzz') === false
 */
export const has = (object, key) => typeof recursiveGet(object, key.split('.'), 0) !== 'undefined';

/**
 * @private
 *
 * Get the value of the dot-notated key on an object
 *
 * @param {Object} object
 * @param {String} key Dot notated, e.g. 'a.b' returns the value of {a: {b: 'foo'}} => 'foo'
 *
 * @example has({a: {b: 'foo'}}, 'a.b') === 'foo'
 * @example has({a: {b: 'foo'}}, 'a.buzz') === undefined
 */
export const get = (object, key) => recursiveGet(object, key.split('.'), 0);

const languageFileCache = {};

/**
 * Retrieve the configured language files from disk, parse the JSON, and store in
 * @param {Object} config
 * @param {Boolean} [config.disableCache=false] true to disable any caching of language files and retrieve fresh on every call
 */
export const getLangConfig = ({ disableCache, languageFiles, translationsCacheTTL=500 }) => languageFiles.map(({ name, path: translationPath }) => {
	try {
		let cacheKey = `${name}-${translationPath}`;
		let cachedValue = languageFileCache[cacheKey];
		if (!disableCache && cachedValue) return cachedValue;

		setTimeout(() => delete languageFileCache[cacheKey], translationsCacheTTL);

		const result =  {
			name,
			translation: JSON.parse(fs.readFileSync(path.resolve(`${process.cwd()}/${translationPath}`)).toString())
		};

		if (!disableCache) languageFileCache[cacheKey] = result;

		return result;
	}
	catch (e) {
		return {
			name,
			translation: null
		};
	}
});

/**
 * Get the i18n component configuration that applies to the node passed in
 */
export const getI18NComponent = ({ node, components }) => {
	let nodeName = node.openingElement.name.name;
	if (!nodeName) return;

	let componentDef = components.find(({ nameRegex }) => nodeName.match(nameRegex));
	return componentDef && {
		name: nodeName,
		id: componentDef.id || DEFAULT_ID_ATTR,
		plural: componentDef.plural || DEFAULT_PLURAL_ATTR,
		fields: componentDef.fields || DEFAULT_FIELDS_ATTR
	};
};

export const getI18nAttributeNodes = ({ node, textComponents, markupTextComponents }) => {

	//see if this is an i18n component and get the field keys from it
	let { id: idAttr, plural: pluralAttr, fields: fieldsAttr } = getI18NComponent({ node, components: textComponents }) || {};

	if (!idAttr) {
		({ id: idAttr, plural: pluralAttr, fields: fieldsAttr } = getI18NComponent({ node, components: markupTextComponents }) || {});
	}

	// This node is not an i18n node that we care about validating
	if (!idAttr) return {};

	let attributes = node.openingElement.attributes;

	// Get the key value and pluralNode (optional) from the attributes of the JSX element
	let idNode;
	let pluralNode;
	let fieldsNode;
	attributes.forEach( ({ type, name, value })  => {
		if (type === 'JSXSpreadAttribute') return;

		if (name.name === idAttr) {
			if (value.type === 'JSXExpressionContainer') {
				value = value.expression;
			}
			idNode = value.type === 'Literal' && value;
		}
		else if (name.name === pluralAttr) {
			pluralNode = value;
		}
		else if (name.name === fieldsAttr) {
			fieldsNode = value;
		}
	});

	return { idNode, pluralNode, fieldsNode };
};