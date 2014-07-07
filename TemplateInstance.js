/**
 * @module liaison/TemplateInstance
 * @private
 */
define([
	"./features",
	"./ObservablePath",
	"./BindingSourceList",
	"./computed",
	"./DOMBindingTarget",
	"./alternateBindingSource"
], function (has, ObservablePath, BindingSourceList, computed) {
	"use strict";

	var EMPTY_OBJECT = {},
		EMPTY_ARRAY = [],
		REGEXP_TEMPLATE_TYPE = /template$/i,
		ATTRIBUTE_IF = "if",
		ATTRIBUTE_BIND = "bind",
		ATTRIBUTE_REPEAT = "repeat",
		MUSTACHE_BEGIN = "{{",
		MUSTACHE_BEGIN_LENGTH = 2,
		MUSTACHE_END = "}}",
		MUSTACHE_END_LENGTH = 2,
		MUSTACHES_LENGTH = 4,
		PARSED_ENTRY_LENGTH = 4,
		PARSED_ENTRY_NODE = 0,
		PARSED_ENTRY_ATTRIBUTENAME = 1,
		PARSED_ENTRY_ATTRIBUTEVALUE = 2,
		PARSED_ENTRY_SOURCE = 3,
		REGEXP_TEMPLATE_TAG = /^template$/i;

	function tokenize(text) {
		var index = 0,
			tokens = [];
		while (true) {
			var begin = text.indexOf(MUSTACHE_BEGIN, index);
			if (begin < 0) {
				break;
			}
			var end = text.indexOf(MUSTACHE_END, begin + MUSTACHE_BEGIN_LENGTH);
			if (end < 0) {
				break;
			}
			tokens.push(text.substring(index, begin));
			var targetToken = text.substring(begin, index = end + MUSTACHE_END_LENGTH);
			tokens.push(targetToken);
		}
		tokens.push(text.substr(index));
		return tokens;
	}

	function tokensFormatter(values) {
		var tokens = [];
		for (var i = 0, l = this.length; i < l; ++i) {
			tokens.push(this[i], values[i] != null ? values[i] : "");
		}
		return tokens.join("");
	}

	function getInstanceData() {
		return this.instanceData;
	}

	/**
	 * An object that instantiates a template and keeps track of the information wrt the instance.
	 * @class module:liaison/TemplateInstance
	 * @param {HTMLTemplateElement} template The template.
	 * @param {Object} model The data model the template should be instantiated with.
	 */
	function TemplateInstance(template, model) {
		var isTemplate = REGEXP_TEMPLATE_TAG.test(template.tagName)
			|| template.tagName === "SCRIPT" && REGEXP_TEMPLATE_TYPE.test(template.getAttribute("type"));
		if (!isTemplate) {
			throw new TypeError("Wrong element type for instantiating template content: " + template.tagName);
		}

		/**
		 * The handles that should be cleaned up when the template instance is removed.
		 * @member {Handle[]}
		 * @private
		 */
		this._handles = [];

		/**
		 * The data model the template should be instantiated with.
		 * @member {Object}
		 */
		this.model = model;

		var boundCreateBindingSourceFactory = template.createBindingSourceFactory.bind(template);

		if (has("polymer-createInstance")) {
			var bindings = [];
			this.content = template.createInstance(model,
				template.createBindingSourceFactory && {prepareBinding: boundCreateBindingSourceFactory},
				undefined,
				bindings);
		} else {
			var toBeBound = [];
			template.content.parsed = template.content.parsed || TemplateInstance.parseNode(template.content);

			/**
			 * The instantiated template content.
			 * @member {DocumentFragment}
			 */
			this.content = TemplateInstance.createContent(template, template.content.parsed, toBeBound);
		}

		/**
		 * The top-level nodes of the instantiated template content.
		 * @member {Node[]}
		 */
		this.childNodes = EMPTY_ARRAY.slice.call(this.content.childNodes);

		EMPTY_ARRAY.forEach.call(this.childNodes, function (node) {
			node._instanceData = this;
		}, this);

		/**
		 * The TemplateInstance of parent template.
		 * @member {module:liaison/TemplateInstance} module:liaison/TempalteInstance#instanceData
		 */
		Object.defineProperty(this, "instanceData", {
			get: getInstanceData.bind(template),
			configurable: true
		});

		if (!has("polymer-createInstance")) {
			TemplateInstance.assignSources(model, toBeBound, boundCreateBindingSourceFactory);
		}

		var computedHandles = computed.apply(model);
		if (!template.preventRemoveComputed) {
			EMPTY_ARRAY.push.apply(this._handles, computedHandles);
		}

		if (has("polymer-createInstance")) {
			EMPTY_ARRAY.push.apply(this._handles, bindings.map(function (binding) {
				binding.remove = binding.close;
				return binding;
			}));
		} else {
			EMPTY_ARRAY.push.apply(this._handles, TemplateInstance.bind(toBeBound));
		}
	}

	/**
	 * Clean-up stuffs.
	 * @method module:liaison/TemplateInstance#remove
	 */
	TemplateInstance.prototype.remove = function () {
		for (var h = null; (h = this._handles.shift());) {
			h.remove();
		}
		for (var node; (node = this.childNodes.pop());) {
			if (node.parentNode) {
				node.parentNode.removeChild(node);
			}
			node._instanceData = null;
		}
	};

	/**
	 * Finds attributes with data binding syntax.
	 * @method module:liaison/TemplateInstance.parseNode
	 * @param {Node} node The root node to parse from.
	 * @returns {Array} The parsed list of (node, attribute name, attribute value, empty) with data binding syntax.
	 */
	TemplateInstance.parseNode = function (node) {
		var currentNode,
			parsed = [],
			iterator = node.ownerDocument.createNodeIterator(
				node,
				NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
				null,
				false);
		while ((currentNode = iterator.nextNode())) {
			if (currentNode.nodeType === Node.ELEMENT_NODE) {
				EMPTY_ARRAY.forEach.call(currentNode.attributes, function (attribute) {
					if (attribute.value.indexOf(MUSTACHE_BEGIN) >= 0) {
						parsed.push(currentNode, attribute.name, attribute.value, undefined);
						var isTemplate = currentNode.tagName === "TEMPLATE"
							|| currentNode.hasAttribute("template")
							|| currentNode.tagName === "SCRIPT"
								&& REGEXP_TEMPLATE_TYPE.test(currentNode.getAttribute("type"));
						// Treat <template if="{{property}}"> as <template if="{{property}}" bind="{{}}">
						if (isTemplate
							&& attribute.name.toLowerCase() === ATTRIBUTE_IF
							&& !currentNode.getAttribute(ATTRIBUTE_BIND)
							&& !currentNode.getAttribute(ATTRIBUTE_REPEAT)) {
							parsed.push(currentNode, ATTRIBUTE_BIND, "{{}}", undefined);
						}
					}
				});
			} else if (currentNode.nodeType === Node.TEXT_NODE) {
				if (currentNode.nodeValue.indexOf(MUSTACHE_BEGIN) >= 0) {
					parsed.push(currentNode, "nodeValue", currentNode.nodeValue, undefined);
				}
			}
		}
		return parsed;
	};

	/**
	 * Instantiate a node in template content, and create a version of parsed data binding syntax adjusted for the instantiated node.
	 * @method module:liaison/TemplateInstance.importNode
	 * @param {Document} doc The document that the instantiated node should belong to.
	 * @param {Node} node The node to instantiate.
	 * @param {Array} parsed
	 *     The parsed list of (node in template, attribute name, attribute value, empty) with data binding syntax.
	 * @param {Array} toBeBound
	 *     The parsed list of (node in instantiated template, attribute name, attribute value, empty) with data binding syntax.
	 * @returns {DocumentFragment} The instantiated node.
	 */
	TemplateInstance.importNode = function (doc, node, parsed, toBeBound) {
		var imported,
			isBroadTemplate = node.tagName === "TEMPLATE"
				|| node.tagName === "template" && node.namespaceURI === "http://www.w3.org/2000/svg"
				|| node.tagName === "SCRIPT" && REGEXP_TEMPLATE_TYPE.test(node.type);

		if (!isBroadTemplate && node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("template")) {
			imported = doc.createElement("template");
			if (!imported.content) {
				imported.content = doc.createDocumentFragment();
			}
			var root = imported.content.appendChild(doc.importNode(node, true));
			root.removeAttribute("template");
			root.removeAttribute(ATTRIBUTE_IF);
			root.removeAttribute(ATTRIBUTE_BIND);
			root.removeAttribute(ATTRIBUTE_REPEAT);
		} else {
			imported = doc.importNode(node, !!isBroadTemplate);
			if (isBroadTemplate) {
				// For non-native template, let recursive clone of node (above) copy the template content,
				// for native template, do that by copying innerHTML
				if (imported.content) {
					imported.innerHTML = node.innerHTML;
				}
				imported.upgradeToTemplate(); // To prevent parsed -> toBeBound copy for template contents
			} else {
				for (var child = node.firstChild; child; child = child.nextSibling) {
					imported.appendChild(TemplateInstance.importNode(doc, child, parsed, toBeBound));
				}
			}
		}

		for (var parsedIndex = 0; (parsedIndex = parsed.indexOf(node, parsedIndex)) >= 0; parsedIndex += PARSED_ENTRY_LENGTH) {
			toBeBound.push(
				imported,
				parsed[parsedIndex + PARSED_ENTRY_ATTRIBUTENAME],
				parsed[parsedIndex + PARSED_ENTRY_ATTRIBUTEVALUE],
				parsed[parsedIndex + PARSED_ENTRY_SOURCE]);
		}

		return imported;
	};

	/**
	 * Creates a clone of the content of the given template.
	 * @method module:liaison/TemplateInstance.createContent
	 * @param {HTMLTemplateElement} template The `<template>` to stamp out the content from.
	 * @param {Array} parsed
	 *     The parsed list of (node in template, attribute name, attribute value, empty) with data binding syntax.
	 * @param {Array} toBeBound
	 *     The parsed list of (node in instantiated template, attribute name, attribute value, empty) with data binding syntax.
	 * @returns {DocumentFragment} The instantiated content of template.
	 */
	TemplateInstance.createContent = function (template, parsed, toBeBound) {
		return TemplateInstance.importNode(template.ownerDocument, template.content, parsed, toBeBound);
	};

	/**
	 * Go through parsed data binding syntax and assign {@link module:liaison/BindingSource BindingSource} to each entries.
	 * @method module:liaison/TemplateInstance.assignSources
	 * @param {Object} model The data model for the template.
	 * @param {Array} toBeBound
	 *     The parsed list of (node in instantiated template, attribute name, attribute value,
	 *     assinged {@link module:liaison/BindingSource BindingSource}) with data binding syntax.
	 * @param {Function} [createBindingSourceFactory]
	 *     A function that takes object path of the model and target attribute name as parameters
	 *     and returns a function to create the binding source given a model and a DOM node.
	 */
	TemplateInstance.assignSources = function (model, toBeBound, createBindingSourceFactory) {
		// Given this function works as a low-level one,
		// it preferes regular loop over array extras,
		// which makes cyclomatic complexity higher.
		/* jshint maxcomplexity: 15 */
		for (var iToBeBound = 0, lToBeBound = toBeBound.length; iToBeBound < lToBeBound; iToBeBound += PARSED_ENTRY_LENGTH) {
			var path,
				factory,
				node = toBeBound[iToBeBound + PARSED_ENTRY_NODE],
				name = toBeBound[iToBeBound + PARSED_ENTRY_ATTRIBUTENAME],
				value = toBeBound[iToBeBound + PARSED_ENTRY_ATTRIBUTEVALUE],
				tokens = tokenize(value);
			if (tokens.length === 3 && !tokens[0] && !tokens[2]) {
				path = tokens[1].substr(MUSTACHE_BEGIN_LENGTH, tokens[1].length - MUSTACHES_LENGTH).trim();
				factory = createBindingSourceFactory && createBindingSourceFactory(path, name);
				toBeBound[iToBeBound + PARSED_ENTRY_SOURCE] = factory ? factory(model, node) : new ObservablePath(model, path);
			} else {
				var list = [],
					texts = [];
				for (var iToken = 0, lToken = tokens.length; iToken < lToken; ++iToken) {
					if (iToken % 2 === 0) {
						texts.push(tokens[iToken]);
					} else {
						path = tokens[iToken].substr(MUSTACHE_BEGIN_LENGTH, tokens[iToken].length - MUSTACHES_LENGTH).trim();
						factory = createBindingSourceFactory && createBindingSourceFactory(path, name);
						list.push(factory ? factory(model, node) : new ObservablePath(model, path));
					}
				}
				toBeBound[iToBeBound + PARSED_ENTRY_SOURCE] = new BindingSourceList(list, tokensFormatter.bind(texts));
			}
		}
	};

	/**
	 * Binds parsed node conents and element attributes to the corresponding {@link module:liaison/BindingSource BindingSource}.
	 * @method module:liaison/TemplateInstance.bind
	 * @param {Array} toBeBound
	 *     The parsed list of (node in instantiated template, attribute name, attribute value,
	 *     {@link module:liaison/BindingSource BindingSource}) with data binding syntax.
	 * @returns {Array.<module:liaison/BindingTarget>}
	 *     The list of data bindings for the parsed node contents and element attributes.
	 */
	TemplateInstance.bind = function (toBeBound) {
		var bound = [];
		for (var i = 0, l = toBeBound.length; i < l; i += PARSED_ENTRY_LENGTH) {
			var name = toBeBound[i + PARSED_ENTRY_ATTRIBUTENAME],
				source = toBeBound[i + PARSED_ENTRY_SOURCE];
			if (typeof (source || EMPTY_OBJECT).observe === "function" || typeof (source || EMPTY_OBJECT).open === "function") {
				bound.push(toBeBound[i + PARSED_ENTRY_NODE].bind(name, source));
			} else {
				console.warn("The specified binding source " + source + " does not have BindingSource interface. Ignoring.");
			}
		}
		return bound;
	};

	return TemplateInstance;
});
