 /**
 * Copyright 2020 Fincura
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function (RED) {
    'use strict';
    var jsforce = require('jsforce');
    var request = require('request');

    var bodyParser = require("body-parser");
    var getBody = require('raw-body');
    var onHeaders = require('on-headers');
    var typer = require('content-type');
    var mediaTyper = require('media-typer');
    var isUtf8 = require('is-utf8');
    var hashSum = require("hash-sum");

    var FincuraApi = require('fincura_api');
    var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;


    var ensureAccessToken = require('../auth').ensureAccessToken;
    var getJwt = require("../auth").getJwtForCredentialsId;

    function putToS3(file, upload_url, contentType) {
        return new Promise(function(resolve, reject){
            var xhr = new XMLHttpRequest();
            xhr.addEventListener('progress', function(e) {
                var done = e.position || e.loaded, total = e.totalSize || e.total;
                console.log('xhr progress: ' + (Math.floor(done/total*1000)/10) + '%');
            }, false);
            if ( xhr.upload ) {
                xhr.upload.onprogress = function(e) {
                    var done = e.position || e.loaded, total = e.totalSize || e.total;
                    console.log('xhr.upload progress: ' + done + ' / ' + total + ' = ' + (Math.floor(done/total*1000)/10) + '%');
                };
            }
            xhr.onreadystatechange = function(e) {
                if ( 4 == this.readyState ) {
                    resolve();
                }
            };

            xhr.open('put', upload_url, true);
            xhr.setRequestHeader("Content-Type", contentType);
            xhr.send(file.buffer);
        });
    }

    function rawBodyParser(req, res, next) {
        if (req.skipRawBodyParser) { next(); } // don't parse this if told to skip
        if (req._body) { return next(); }
        req.body = "";
        req._body = true;

        var isText = true;
        var checkUTF = false;

        if (req.headers['content-type']) {
            var contentType = typer.parse(req.headers['content-type'])
            if (contentType.type) {
                var parsedType = mediaTyper.parse(contentType.type);
                if (parsedType.type === "text") {
                    isText = true;
                } else if (parsedType.subtype === "xml" || parsedType.suffix === "xml") {
                    isText = true;
                } else if (parsedType.type !== "application") {
                    isText = false;
                } else if (parsedType.subtype !== "octet-stream") {
                    checkUTF = true;
                } else {
                    // applicatino/octet-stream
                    isText = false;
                }

            }
        }

        getBody(req, {
            length: req.headers['content-length'],
            encoding: isText ? "utf8" : null
        }, function (err, buf) {
            if (err) { return next(err); }
            if (!isText && checkUTF && isUtf8(buf)) {
                buf = buf.toString()
            }
            req.body = buf;
            next();
        });
    }

    function createRequestWrapper(node,req) {
        // This misses a bunch of properties (eg headers). Before we use this function
        // need to ensure it captures everything documented by Express and HTTP modules.
        var wrapper = {
            _req: req
        };
        var toWrap = [
            "param",
            "get",
            "is",
            "acceptsCharset",
            "acceptsLanguage",
            "app",
            "baseUrl",
            "body",
            "cookies",
            "fresh",
            "hostname",
            "ip",
            "ips",
            "originalUrl",
            "params",
            "path",
            "protocol",
            "query",
            "route",
            "secure",
            "signedCookies",
            "stale",
            "subdomains",
            "xhr",
            "socket" // TODO: tidy this up
        ];
        toWrap.forEach(function(f) {
            if (typeof req[f] === "function") {
                wrapper[f] = function() {
                    node.warn(RED._("httpin.errors.deprecated-call",{method:"msg.req."+f}));
                    var result = req[f].apply(req,arguments);
                    if (result === req) {
                        return wrapper;
                    } else {
                        return result;
                    }
                }
            } else {
                wrapper[f] = req[f];
            }
        });


        return wrapper;
    }
    function createResponseWrapper(node,res) {
        var wrapper = {
            _res: res
        };
        var toWrap = [
            "append",
            "attachment",
            "cookie",
            "clearCookie",
            "download",
            "end",
            "format",
            "get",
            "json",
            "jsonp",
            "links",
            "location",
            "redirect",
            "render",
            "send",
            "sendfile",
            "sendFile",
            "sendStatus",
            "set",
            "status",
            "type",
            "vary"
        ];
        toWrap.forEach(function(f) {
            wrapper[f] = function() {
                node.warn(RED._("httpin.errors.deprecated-call",{method:"msg.res."+f}));
                var result = res[f].apply(res,arguments);
                if (result === res) {
                    return wrapper;
                } else {
                    return result;
                }
            }
        });
        return wrapper;
    }

    function FincuraEventListen(n) {
        RED.nodes.createNode(this,n);
        if (RED.settings.httpNodeRoot !== false) {
            var node = this;

            this.url = '/fnc-webhook/' + n.id;
            this.fincura_api_creds = n.fincura_api_creds;
            this.fincura_creds = RED.nodes.getCredentials(this.fincura_api_creds);

            ensureAccessToken(this.fincura_creds).then((data) => {
                var token = data['access_token'];
                var defaultClient = FincuraApi.ApiClient.instance;
                var opts = {url: defaultClient.basePath + '/v1/webhook'};
                opts.method = 'POST';
                opts.headers = {
                    "Authorization": "Bearer " + data['access_token'],
                    "Content-Type": "application/json"
                };

                var webhook_url = process.env.NODE_RED_BASE_URL + this.url
                opts.body = JSON.stringify({webhook_url: webhook_url, event_type: '*'});

                request(opts, function(err, res, body) {
                    if(err){
                        console.log('error');
                        console.log(err);
                    }
                });
            });

            this.errorHandler = function(err,req,res,next) {
                node.warn(err);
                res.sendStatus(500);
            };

            this.callback = function(req,res) {
                var msgid = RED.util.generateId();
                res._msgid = msgid;
                node.send({_msgid:msgid,req:req,res:createResponseWrapper(node,res),payload:JSON.parse(req.body)});
            };

            var httpMiddleware = function(req,res,next) { next(); }

            if (RED.settings.httpNodeMiddleware) {
                if (typeof RED.settings.httpNodeMiddleware === "function") {
                    httpMiddleware = RED.settings.httpNodeMiddleware;
                }
            }

            var maxApiRequestSize = RED.settings.apiMaxLength || '5mb';
            var jsonParser = bodyParser.json({limit:maxApiRequestSize});
            var urlencParser = bodyParser.urlencoded({limit:maxApiRequestSize,extended:true});

            RED.httpNode.post(this.url,httpMiddleware,jsonParser,urlencParser,rawBodyParser,this.callback,this.errorHandler);

            this.on("close",function() {
                var node = this;
                RED.httpNode._router.stack.forEach(function(route,i,routes) {
                    if (route.route && route.route.path === node.url && route.route.methods[node.method]) {
                        routes.splice(i,1);
                    }
                });
            });
        } else {
            this.warn(RED._("httpin.errors.not-created"));
        }
    }

    RED.nodes.registerType("fincura-event-listen in", FincuraEventListen);



    // Bulk File

    function notifyFileRecievedLocalDev(access_token, transaction_id, bulk_file) {
        var defaultClient = FincuraApi.ApiClient.instance;
        // this is not a published public endpoint, so we need to build the request outself
        var path = `/v1/api/bulk-files/guid/${bulk_file['uuid']}/upload_complete`;
        var opts = {};
        opts.defaultPort = 8000;
        opts.method = 'POST';
        opts.headers = {
            "Authorization": "Bearer " + access_token,
            "Content-Type": "application/json"
        };
        opts.url = defaultClient.basePath + path
        opts.body = JSON.stringify({"original_transaction_id": transaction_id});

        request(opts, function(err, res, body) {
            if(err){
                console.log('error');
                console.log(err);
            }else{
                // do nothing
            }
        });
    }

    function FincuraBulkFileCreate(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        this.processor_key = config.processor_key;
        this.fincura_api_creds = config.fincura_api_creds;

        this.fincura_creds = RED.nodes.getCredentials(this.fincura_api_creds);

        node.on('input', function (msg) {

            const file = msg.req.files[0];

            ensureAccessToken(this.fincura_creds).then((refresh_data) => {

                const contentType = (file.mimetype == 'application/vnd.ms-excel.sheet.macroenabled.12') ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : file.mimetype;
        
                var api = new FincuraApi.FilesApi();
                var bulkFileCreate = new FincuraApi.BulkFileCreate();

                bulkFileCreate.processor_key = this.processor_key;
                bulkFileCreate.media_type = contentType;

                api.createBulkFile({ bulkFileCreate: bulkFileCreate }, (error, data, response) => {
                    if (error) {
                        console.error(error);
                    } else {
                        console.log('create bulk file resp')
                        // got to be an easier way
                        msg.payload['bulk_file'] = JSON.parse(JSON.stringify(data));
                        msg.payload['bulk_file']['transaction_id']  = response.headers['x-transaction-id'];
                        const upload_url = msg.payload['bulk_file']['upload_url'];
                        delete msg.payload['bulk_file']['upload_url'];
                        putToS3(file, upload_url, contentType).then(() => {

                            if(process.env.FINCURA_ENV == 'local') {
                                // if local let the local server know to start processing document - happens automatically in deployed environments
                                notifyFileRecievedLocalDev(
                                    refresh_data['access_token'], 
                                    response.headers['x-transaction-id'],
                                    msg.payload['bulk_file']
                                );
                            }

                            node.send(msg);
                        })
                    }    
                });
            });
        });
    }

    RED.nodes.registerType("fincura-bulk-file-create in", FincuraBulkFileCreate);

}