/*
Facepunch Archive Tool
Version  0.1.0   

Author: 
    cpancake / supersnail11
Purpose: 
    Archiving Facepunch threads into a variety of storage formats,
    and being able to easily analyze and export that data.
Usage:
    Check the README file for more info.
License:
    MIT
*/
var commander = require('commander'), // command line arguments
    fs        = require('fs'),
    qs        = require('querystring'),
    colors    = require('colors'),
    Mimicry   = require('mimicry'),   // http requests, with cookie
    cheerio   = require('cheerio'),   // jquery wrapper (easy HTML parsing)
    moment    = require('moment');    // date parsing & formatting

var mimicry = new Mimicry();

commander
    .version('0.1.0')
    // specify a single thread URL (takes precedent over --threads)
    .option('-t, --thread [value]', 'thread URL to archive.')
    // specify a list of URLs in a file - see README
    .option('-f, --file [value]', 'list of URLs to archive, in a file (see README)')
    // output plugin
    .option('-p, --plugin [value]', 'select an output plugin to use.')
    // output directory, if the plugin uses it
    .option('-o, --output [value]', 'output directory, if required by the plugin')
    // output database, if the plugin uses it
    .option('-db, --database [value]', 'output database, if required by the plugin (see README)')
    // list output plugins
    .option('--plugins', 'list output plugins (all other options ignored)')
    .parse(process.argv);

var Tool = {};

// get all output plugins
Tool.Plugins = {};
fs.readdirSync('./plugins').forEach(function(f) {
    if(f.substr(-2) != 'js') return;
    var plugin = require('./plugins/' + f);
    Tool.Plugins[plugin.shortname] = plugin;
});

console.log('Facepunch Archive Tool 0.1.0'.yellow);

// display list of output plugins and abort
if(commander.plugins)
{
    console.log('Output Plugins: ');
    Object.keys(Tool.Plugins).forEach(function(k) {
        var p = Tool.Plugins[k];
        console.log('\t' + p.name.cyan + '\t-p ' + p.shortname);
    });
    process.exit();
}

function displayErrorAndDie(msg)
{
    commander.outputHelp();
    console.log(msg.red);
    process.exit();
}

if(!commander.plugin)
    displayErrorAndDie('Error: no output plugin specified.');

if(!Tool.Plugins[commander.plugin])
    displayErrorAndDie('Error: output plugin does not exist.');

if(!commander.file && !commander.thread)
    displayErrorAndDie('Error: no thread or file specified.');

// it's not perfect, but if the URL doesn't match this you're doing something wrong anyways
var thread_regex = /facepunch\.com\/showthread\.php.+?t=(\d+)/;

var threads = {};
// single thread
if(commander.thread)
    threads[0] = commander.thread;
else // thread file
{
    if(!fs.existsSync(commander.file))
        displayErrorAndDie('Input file does not exist.');
    fs.readFileSync(commander.file, {encoding: 'utf8'}).split('\n').forEach(function(l) {
        var parts = l.split(' ');
        if(parts.length != 2 || isNaN(parts[0]))
            displayErrorAndDie('Error: invalid input file format (see README).');
        threads[parseInt(parts[0])] = parts[1];
    });
}

// validate each thread
Object.keys(threads).forEach(function(k) {
    if(!thread_regex.test(threads[k]))
        displayErrorAndDie('Error: ' + threads[k] + ' is not a valid Facepunch link.');
});

// initialize the plugin
var plugin = Tool.Plugins[commander.plugin];
var err = plugin.initialize(commander); // done synchronously because lazy
if(err) displayErrorAndDie(err);
console.log(('Successfully initialized ' + plugin.name).grey);

// need to be sure it's set, otherwise dates won't parse correctly
moment.lang('en');

// let the plugin know about the threads we'll be throwing at it
plugin.threads(threads);

// now, for each thread...
Object.keys(threads).forEach(function(k) {
    var thread = threads[k];
    // extract the thread ID, so we can properly make requests
    var threadID = thread_regex.exec(thread)[1];
    // check how many pages it has
    startParsing(threadID);
});

function startParsing(threadID, form)
{   
    if(form)
        mimicry.get('http://facepunch.com/cdn-cgi/l/chk_jschl?' + qs.stringify(form), { 'Referer': 'http://facepunch.com/showthread.php?t=' + threadID}, parse);
    else
        mimicry.get('http://facepunch.com/showthread.php?t=' + threadID, parse);
    function parse(err, body, headers) {
        if(/<title>Just a moment...<\/title>/.test(body))
            cloudflareChallenge(body, function(data) { startParsing(threadID, data); });
        else if(err)
            displayErrorAndDie('Error: unable to check page count - possibly CloudFlare related.'); // todo: ~smooth~ error handling
        else
        {
            var $ = cheerio.load(body);
            var page_txt = $('.popupctrl').first().text();
            var max_page = 1;
            if(page_txt != "") // page nav control found
                max_page = parseInt(/Page \d+ of (\d+)/.exec(page_txt)[1]); // mmm, regex
            // then, for each page
            for(var i=1;i<max_page+1;i++)
            {
                mimicry.get('http://facepunch.com/showthread.php?t=' + threadID + '&page=' + i, function(err, body) {
                    if(err) 
                        displayErrorAndDie('Error: unable to fetch page.');
                    var $ = cheerio.load(body);
                    var multiplePages = /Page (\d+) of \d+/.test(page_txt);
                    // iterate over every post
                    $('.postcontainer').each(function(_, post) {
                        var _$ = $(post);
                        var date_txt = _$.find('.date').text();
                        var date;
                        // if the thread has been posted in in the last month, they'll be "ago" dates, otherwise:
                        if(date_txt.indexOf('Ago') == -1)
                            date = moment(date_txt, 'Do MMMM YYYY').unix(); // using moment to convert it to unix time, ~YOLO~
                        else
                        {
                            // create a new moment of today, then subtract the date from it
                            var m = moment();
                            // for example, "4 weeks ago" would turn into m.subtract("weeks", 4)
                            m.subtract(date_txt.split(' ')[1].toLowerCase(), parseInt(date_txt.split(' ')[0]));
                            date = m.unix();
                        }
                        // post number (i.e. "Post #2")
                        var post_number = _$.find('.postcounter').text().trim().substr(6);
                        // post ID (the part that comes in the &p=numbers part of the URL)
                        var post_id = /&p=(\d+)/.exec(_$.find('.postcounter').attr('href'))[1]
                        var username = _$.find('.username').text();
                        // determine the user type
                        var user_type = 'blue';
                        if(_$.find('.username font').attr('color') == '#A06000')
                            user_type = 'gold';
                        if(_$.find('.username span').attr('style') && _$.find('.username span').attr('style').indexOf('#00aa00') != -1)
                            user_type = 'mod';
                        var content = _$.find('.postcontent').html().trim();
                        // for searching: no quotes or tags
                        _$.find('.postcontent .quote').remove();
                        var sanitized_content = _$.find('.postcontent').text().trim();
                        // put ratings into a nice object
                        var ratings = {};
                        _$.find('.rating_results span').each(function(i, r) {
                            ratings[$(r).find('img').attr('alt').replace(/ /, '_').toLowerCase()] = parseInt($(r).find('strong').text());
                        });
                        // finally, user agent stuff
                        var userinfo = { os: 'Unknown', browser: 'Unknown' };
                        if(_$.find('.postlinking img').length >= 4) // both OS and browser (and maybe flagdog)
                        {
                            userinfo.os = _$.find('.postlinking img').first().attr('alt');
                            // if flagdog isn't second
                            if($(_$.find('.postlinking img').get(1)).attr('src').indexOf('flags') == -1)
                                userinfo.browser = /\/fp\/browser\/(.+?)\.png/.exec($(_$.find('.postlinking img').get(1)).attr('src'))[1].capitalize();
                        }
                        else // just OS, or unknown
                            userinfo.os = _$.find('.postlinking img').first().attr('alt');
                        var flag = _$.find('.postlinking img').get(2);
                        // flagdog, if possible
                        if($(flag).attr('src') && $(flag).attr('src').indexOf('flags') != -1)
                            userinfo.country = $(flag).attr('alt');

                        // i forgot how javascript scopes work and i don't remember if threadID still exists in this scope
                        // as it was when this callback was created, so better safe than sorry i guess
                        var threadID = parseInt(/showthread\.php.+?t=(\d+)/.exec(body)[1]);

                        // now, we've collected all the data, send it to the output plugin for processing
                        plugin.post({
                            thread: threadID,
                            page: multiplePages ? parseInt(/Page (\d+) of \d+/.exec(body)[1]) : 1,
                            author: {
                                name: username,
                                info: userinfo, // i'm noticing some inconsistencies in naming here
                                type: user_type
                            },
                            date: date,
                            number: post_number,
                            id: post_id,
                            content: content,
                            sanitized_content: sanitized_content,
                            ratings: ratings
                        });
                    });
                });
            }
        }    
    }
}

function cloudflareChallenge(body, callback) 
{
    // match the challenge, but not the second part (the part that includes parseInt)
    var challenge = eval(/a\.value = (.+?);/.exec(body)[1]);
    // add t.length (domain) to the challenge
    challenge += 'facepunch.com'.length;
    // get the other part of the challenge
    var vc = /type="hidden" name="jschl_vc" value="(.+?)"\/>/.exec(body)[1];
    callback({
        jschl_vc: vc,
        jschl_answer: challenge
    });
}

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
}