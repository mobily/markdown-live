(function(){
	'use strict';

	var fs = require('fs'),
		path = require('path'),
		express = require('express'),
		app = express(),
		server = require('http').Server(app),
		io = require('socket.io')(server),
		haml = require('hamljs'),
		filewatcher = require('filewatcher')({ interval: 1000 }),
		dirwatcher = require('watch'),
		open = require('open'),
		markdown = require('marked'),
		Promise = require('promise');

	var MarkdownLive = function(options){
		if (!(this instanceof MarkdownLive)){
			return new MarkdownLive(options);
		}

		this.initialize(options);
	}

	MarkdownLive.prototype = (function(){

		var _ = {
			options: {
				port: 2304,
				dir: path.resolve('.'),
				verbose: false,
				help: false
			},
			log: function(message){
				if (!this.options.verbose) return;

				var arr = _.argsToArr(arguments);

				arr[0] = _.joinArgs('[mdlive] ', message);
				console.log.apply(null, arr);
			},
			isEmpty: function(arr){
				return !arr.length;
			},
			isBool: function(obj){
				return toString.call(obj) === '[object Boolean]';
			},
			isObject: function(obj){
				var type = typeof obj;
				return type === 'function' || type === 'object' && !!obj;
			},
			argsToArr: function(args){
				return Array.prototype.slice.call(args);
			},
			joinArgs: function(){
				return _.argsToArr(arguments).join('');
			},
			has: function(obj, key){
				return obj !== null && hasOwnProperty.call(obj, key);
			},
			extend: function(obj){
				for (var i = 1, x = arguments.length; i < x; i++){
					var source = arguments[i];

					for (var property in source){
						if (_.has(source, property)){
							obj[property] = source[property];
						}
					}
				}

				return obj;
			},
			buildData: function(file, data){
				return { 
					name: path.basename(file), 
					path: file, 
					markdown: data,
					content: markdown(data)
				}
			}
		}

		var Message = {
			start: 'server: %s',
			empty: 'no *.md files in %s',
			emit: 'file: %s'
		}

		return {
			/**
			 *	@class MarkdownLive
			 *
			 *	@constructor
			 */
			constructor: MarkdownLive,
			/**	
			 *	@method initialize
			 *
			 *	@param {Object} options
			 */
			initialize: function(options){
				this.options = _.extend(_.options, options);
				_.options = this.options;

				this.url = _.joinArgs('http://localhost:', this.options.port);

				this.help();
				this.start();
				this.socket();
				this.open();
			},
			/**
			 *	Show instruction.
			 *
			 *	@method help
			 */
			help: function(){
				if (!this.options.help) return;

				var stream = fs.createReadStream(path.join(__dirname, 'help.txt'));
				stream.pipe(process.stdout);
				stream.on('end', function(){
					process.exit();
				});
			},
			/**
			 *	Start a server.
			 *
			 *	@method start
			 */
			start: function(){
				var this_ = this;

				app.use(express.static(path.join(__dirname, 'public')));

				app.get('/', function (req, res){
					var view = fs.readFileSync(path.join(__dirname, 'views', 'index.haml'), 'utf8'),
						prepare = this_.prepare();

					prepare.then(function(){
						this_.watch();
						this_.check();
					});

					res.end(haml.render(view));
				});

				server.listen(this.options.port);
				_.log(Message.start, this.url);
			},
			/**
			 *	Find all *.md files and create new array with data.
			 *
			 *	@method prepare
			 */
			prepare: function(){
				var this_ = this,
					promise = new Promise(function(resolve, reject){

						fs.readdir(this_.options.dir, function(err, files){
							if (err) return reject(err);

							this_.files = files.filter(function(file){
								return /\.md$/.test(file);
							}).map(function(name){
								var file = path.join(this_.options.dir, name),
									content = fs.readFileSync(file, 'utf8');

								return _.buildData(file, content);
							});

							if (_.isEmpty(this_.files)){ 
								_.log(Message.empty, this_.options.dir);
							}

							resolve();
						});

					});

				return promise;
			},
			/**
			 *	Listen on file changes.
			 *
			 *	@method watch
			 */
			watch: function(){
				var this_ = this;

				filewatcher.removeAll();

				this.files.forEach(function(file){
					filewatcher.add(file.path);
				});

				filewatcher.on('change', function(file){
					fs.readFile(file, 'utf8', function(err, data){
						if (err) return;
						io.emit('data', _.buildData(file, data));
						_.log(Message.emit, file);
					});
				});
			},
			/**
			 *	Listen on directory changes (removing or creating .md files).
			 *
			 *	@method check
			 */
			check: function(){
				var this_ = this;

				dirwatcher.unwatchTree(this.options.dir);

				dirwatcher.watchTree(this.options.dir, { 
					ignoreDirectoryPattern: /.+/,
					ignoreUnreadableDir: true,
					filter: function(file){
						return /\.md$/.test(file);
					}
				}, function(file, current, prev){
					if (_.isObject(file)) return;

					if (prev === null){
						fs.readFile(file, 'utf8', function(err, data){
							if (err) return;

							filewatcher.add(file);
							io.emit('push', _.buildData(file, data));
						});
					} else if (current.nlink === 0) {
						io.emit('rm', file);
						filewatcher.remove(file);
					}
				});
			},
			/**
			 *	Open a browser.
			 *
			 *	@method open
			 */
			open: function(){
				open(this.url);	
			},
			/**
			 *	Create websocket events.
			 *
			 *	@method open
			 */
			socket: function(){
				var this_ = this;

				io.on('connection', function(socket){
					io.emit('initialize', this_.files);
				});
			}
		}
	})();

	module.exports = MarkdownLive;

})();