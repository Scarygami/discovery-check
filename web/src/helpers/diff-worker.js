(function (global) {
	global.importScripts('/bower_components/jsdiff/diff.min.js');

	global.onmessage = function (e) {
	  global.postMessage(global.JsDiff.diffLines(e.data[1], e.data[0]));
	};
}(this));
