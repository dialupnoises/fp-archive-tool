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

// tell the plugin what threads are what
exports.threads = function(_threads) {
	threads = _threads;
	// create a directory for each thread i.e. thread13 for version 13
	Object.keys(threads).forEach(function(version) { 
		if(!fs.existsSync(path.join(output, 'thread' + version)))
			fs.mkdirSync(path.join(output, 'thread' + version));
		// so the post function can figure out what thread id is what version
		thread_ids_to_versions[thread_regex.exec(threads[version])[1]] = version;
	});
}

// write a post to a file
exports.post = function(post, callback) {
	// get the thread directory
	var prefix = path.join(output, 'thread' + thread_ids_to_versions[post.thread]);
	// get the page directory
	var dir = path.join(prefix, 'page' + post.page);
	if(!fs.existsSync(dir))
		fs.mkdirSync(dir);
	// write the post in JSON
	fs.writeFile(path.join(dir, 'post' + post.number + '.json'), JSON.stringify(post), function(err) { if(err) throw err; callback(); });
}

// input plugin mode
function input() {
	var input; // input directory

	this.initialize = function(commander) {
		if(!commander.input)
			return 'Error: no input directory specified';
		if(!fs.existsSync(commander.input))
			return 'Error: input directory does not exist';
		input = commander.input;
	}

	// return a list of all the numbers of all the posts in every thread in the input directory
	this.posts = function(callback) {
		var threads = [];
		var thread_pages = []; // pages by thread
		var posts = {};
		// keep track of progress
		var threads_found = 0;
		var threads_done = 0;
		var pages_found = 0;
		var pages_done = 0;
		// read input directory
		fs.readdir(input, function(err, files) {
			files.forEach(function(file) {
				if(file.length > 6 && file.substr(0, 6) == 'thread') // find thread dirs
				{
					threads_found++;
					threads.push(file);
				}
			});
			processThreads(); // next step
			checkCompletion();
		});
		// find the pages in the thread directories
		function processThreads()
		{
			threads.forEach(function(thread) {
				thread_pages[thread] = [];
				fs.readdir(path.join(input, thread), function(err, files) {
					files.forEach(function(file) {
						// find page dirs
						if(file.length > 4 && file.substr(0, 4) == 'page')
						{
							pages_found++;
							thread_pages[thread].push(file);
						}
					});
					threads_done++;
					processPages(thread);
					checkCompletion();
				});
			});
		}
		// find the posts in the page directories
		function processPages(thread)
		{
			thread_pages[thread].forEach(function(page) {
				fs.readdir(path.join(input, thread, page), function(err, files) {
					// find post files
					files.forEach(function(file) {
						if(file.length > 4 && file.substr(0, 4) == 'post')
						{
							posts[thread.substr(6)] = posts[thread.substr(6)] || {};
							posts[thread.substr(6)][page.substr(4)] = posts[thread.substr(6)][page.substr(4)] || [];
							// add the post number to the array
							posts[thread.substr(6)][page.substr(4)].push(file.substr(4, file.length - path.extname(file).length));
						}
					});
					pages_done++;
					checkCompletion();
				});
			});
		}
		// exit when done
		function checkCompletion()
		{
			if(threads_done > 0 && threads_done >= threads_found && pages_done > 0 && pages_done >= pages_found)
				callback(null, posts);
		}
	}

	// get a post from a specified thread and page
	this.post = function(thread, page, post, callback)
	{
		var file = path.join(input, 'thread' + thread, 'page' + page, 'post' + post + '.json');
		fs.readFile(file, {encoding: 'utf8'}, function(err, str) {
			if(err)
				callback(err);
			else
				callback(null, JSON.parse(str));
		});
	}
}

exports.input = new input();