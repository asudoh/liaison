/**
 * A module to make {@link HTMLTemplateElement#bind}, etc. upgrade delite widgets in stamped out template content,
 * and to support data binding between widget property/attribute and {@link module:liaison/BindingSource BindingSource}.
 * @module liaison/delite/TemplateInstanceExtemsion
 * @private
 */
define([
	"delite/register",
	"../features",
	"../schedule",
	"../TemplateInstance",
	"../DOMTreeBindingTarget",
	"./WidgetBindingTarget"
], function (register, has, schedule, TemplateInstance) {
	"use strict";

	// If document.register() is there, upgradable elements will be upgraded automatically.
	// "document-register" has() flag is tested in delite/register.
	if (!has("document-register") && typeof Node !== "undefined") {
		var origImportNode = TemplateInstance.importNode;
		TemplateInstance.importNode = function () {
			var imported = origImportNode.apply(this, arguments);
			if (imported.nodeType === Node.ELEMENT_NODE) {
				register.upgrade(imported);
				if (imported.startup && !imported._started) {
					schedule(imported.startup.bind(imported));
				}
			}
			return imported;
		};
	}

	var origRemove = TemplateInstance.prototype.remove;
	TemplateInstance.prototype.remove = function () {
		this.childNodes.forEach(function (node) {
			var currentNode,
				iterator = node.ownerDocument.createNodeIterator(node, NodeFilter.SHOW_ELEMENT, null, false);
			while ((currentNode = iterator.nextNode())) {
				if (typeof currentNode.buildRendering === "function") {
					currentNode.destroy();
				}
			}
		});
		origRemove.apply(this, arguments);
	};

	return TemplateInstance;
});
