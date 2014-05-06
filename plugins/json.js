/*
JSON export plugin

Exports each post as a JSON file, under a folder with its page.
*/

var fs   = require('fs'),
	path = require('path');

exports.name = 'JSON Exporter';
exports.shortname = 'json';

var output;
exports.initialize = function(commander) {
	if(!commander.output)
		return 'Error: no output directory specified.';
	if(!fs.existsSync(commander.output))
		fs.mkdirSync(commander.output);
	output = commander.output;
}

var threads;
var thread_ids_to_versions = {}; // maps thread ids to versions; what else?
var thread_regex = /facepunch\.com\/showthread\.php.+?t=(\d+)/;

exports.threads = function(_threads) {
	threads = _threads;
	Object.keys(threads).forEach(function(version) {
		if(!fs.existsSync(path.join(output, 'thread' + version)))
			fs.mkdirSync(path.join(output, 'thread' + version));
		thread_ids_to_versions[thread_regex.exec(threads[version])[1]] = version;
	});
}

exports.post = function(post) {
	var prefix = path.join(output, 'thread' + thread_ids_to_versions[post.thread]);
	var dir = path.join(prefix, 'page' + post.page);
	console.log('Writing post ' + post.number);
	if(!fs.existsSync(dir))
		fs.mkdirSync(dir);
	fs.writeFile(path.join(dir, 'post' + post.number + '.json'), post, function(err) { if(err) throw err; });
}