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
        Markdown = require('marked'),
        renderer = new Markdown.Renderer();

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
                help: false,
                file: false,
                socket: 'http://localhost:2304'
            },
            log: function(message){
                if (!this.options.verbose) return;

                var arr = _.argsToArr(arguments);

                arr[0] = _.joinArgs('[mdlive] ', message);
                console.log.apply(null, arr);
            },
            isMD: function(file){
                return /\.(markdown|mdown|mkdn|md|mkd|mdwn|mdtxt|mdtext)$/.test(file);
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
                var name = path.basename(file),
                    dir = file.replace(name, '');

                return { 
                    name: name, 
                    dir: dir,
                    path: file, 
                    markdown: data,
                    content: Markdown(data, { renderer: renderer })
                }
            },
            renderer: function(){
                var view = fs.readFileSync(path.join(__dirname, 'views', 'code.haml'), 'utf8');

                renderer.code = function(code, lang){
                    return haml.render(view, {
                            locals: {
                                code: code,
                                lang: lang
                            }
                        });
                }
            }
        }

        var Message = {
            start: 'server: %s',
            empty: 'no *.md files in %s',
            emit: 'saved: %s',
            watch: 'watch: %s',
            added: 'added: %s',
            removed: 'removed: %s',
            not_exist: 'doesn\'t exist: %s'
        }


        return {
            /**
             *  @class MarkdownLive
             *
             *  @constructor
             */
            constructor: MarkdownLive,
            /** 
             *  @method initialize
             *
             *  @param {Object} options
             */
            initialize: function(options){
                this.options = _.extend(_.options, options);

                _.options = this.options;
                _.renderer();

                this.url = _.joinArgs('http://localhost:', this.options.port);

                this.help();
                this.start();
                this.socket();
                this.open();
            },
            /**
             *  Show help.
             *
             *  @method help
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
             *  Start a server.
             *
             *  @method start
             */
            start: function(){
                var this_ = this;

                app.use(express.static(path.join(__dirname, 'public')));

                app.get('/', function (req, res){
                    var view = fs.readFileSync(path.join(__dirname, 'views', 'index.haml'), 'utf8');

                    this_.prepare();
                    this_.watch();
                    this_.check();

                    var render = haml.render(view, {
                        locals: {
                            socket: this_.options.socket
                        }
                    })

                    res.end(render);
                });

                server.listen(this.options.port);
                _.log(Message.start, this.url);
            },
            /**
             *  Find all *.md files and create new array.
             *
             *  @method prepare
             */
            prepare: function(){
                var this_ = this;

                var files = fs.readdirSync(this.options.dir).filter(function(file){
                    return _.isMD(file);
                }).map(function(name){
                    return path.join(this_.options.dir, name);
                }) || [];

                if (this.options.file){
                    this.options.file.split(',').forEach(function(file){
                        if (fs.existsSync(file) && _.isMD(file)){
                            files.push(file);
                        } else {
                            _.log(Message.not_exist, file);
                        }
                    });
                }

                this.files = files.map(function(file){
                    var content = fs.readFileSync(file, 'utf8');
                    return _.buildData(file, content);
                });
            },
            /**
             *  Listen on file changes.
             *
             *  @method watch
             */
            watch: function(){
                var this_ = this;

                filewatcher.removeAll();

                this.files.forEach(function(file){
                    filewatcher.add(file.path);
                    _.log(Message.watch, file.path);
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
             *  Listen on directory changes (removing or creating .md files).
             *
             *  @method check
             */
            check: function(){
                var this_ = this;

                dirwatcher.unwatchTree(this.options.dir);

                dirwatcher.watchTree(this.options.dir, { 
                    ignoreDirectoryPattern: /.+/,
                    ignoreUnreadableDir: true,
                    filter: function(file){
                        return _.isMD(file);
                    }
                }, function(file, current, prev){
                    if (_.isObject(file)) return;

                    if (prev === null){
                        fs.readFile(file, 'utf8', function(err, data){
                            if (err) return;

                            filewatcher.add(file);
                            _.log(Message.added, file);
                            io.emit('push', _.buildData(file, data));
                        });
                    } else if (current.nlink === 0) {
                        io.emit('rm', file);
                        filewatcher.remove(file);
                        _.log(Message.removed, file);
                    }
                });
            },
            /**
             *  Open a browser.
             *
             *  @method open
             */
            open: function(){
                open(this.url); 
            },
            /**
             *  Create websocket events.
             *
             *  @method socket
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