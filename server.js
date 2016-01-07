// Requirements:
// 1. You must install all the node.js modules imported below (npm install X).
// 2. You must set AWS credentials in environment variables.
//    One way to do so if using standard .aws/config files is:
//    export AWS_ACCESS_KEY_ID=$(awk '/aws_access_key_id/ { print $3 }' ~/.aws/config)
//    export AWS_SECRET_ACCESS_KEY=$(awk '/aws_secret_access_key/ { print $3 }' ~/.aws/config)
//    export AWS_REGION=$(awk '/region/ { print $3 }' ~/.aws/config)
// 4. You must create a passwords.json file which contains usernames and encrypted passwords.
//    It should look like this:
//    {
//      "alex": '$2a$10$/iEmHzBrsGbxT9Jx2KIReOPlnYs4ee7al3c234QQsnGslRix/hKQe',
//    }
//    You can create the passwords using:
//    node bcrypt-password.js 'my password'
// 5. If you want SSL (recommended since using HTTP BASIC authentication), ensure
//    HTTPS_PORT is defined below, and that you have letsencrypt certficiates.
//    This is how the letsencrypt certificates were created:
//    git clone https://github.com/letsencrypt/letsencrypt
//    letsencrypt/letsencrypt-auto certonly --standalone -d camera.hioreanu.net
//    mkdir ssl
//    sudo cp /etc/letsencrypt/live/camera.hioreanu.net ssl
//    for f in cert.pem  chain.pem  fullchain.pem  privkey.pem ; do
//      sudo cp /etc/letsencrypt/live/camera.hioreanu.net/${f} ssl 
//    done
//    sudo chown $USER ssl/*
//    sudo chmod 600 ssl/*
//    Note: you will periodically (every 90d) need to re-run these commands,
//    since letsencrypt certificates only last 90 days.  TODO: automate this.
//    Note: you should probably disable regular HTTP if you enable HTTPS.  Do
//    so by setting HTTP_PORT to 0.
// 6. If you want to present this application on the standard ports (80, 443),
//    which regular users can't bind to, you will need to take additional steps.
//    This is recommended since many proxies block non-standard HTTP/HTTPS ports.
//    One mechanism on Ubuntu/Debian to do so is to allow node.js to listen on
//    the standard ports (note that this is not recommended for multi-user systems
//    since then any user could then use node.js to bind to the standard ports):
//    sudo apt-get install libcap2-bin
//    sudo setcap 'cap_net_bind_service=+ep' /usr/bin/nodejs
// 7. Run the application as so (TODO: init script):
//    node server.js

var http = require('http');
var auth = require('basic-auth');
var AWS = require('aws-sdk');
var https = require('https');
var fs = require('fs');
var bcrypt = require('bcrypt-nodejs');

var HTTP_PORT = 0;
var HTTPS_PORT = 443;

var passwords = require('./passwords.json');

function Show404(response) {
  response.statusCode = 404;
  response.setHeader('Content-Type', 'text/plain');
  response.write('Not found.\n');
  response.end();
}

function ShowDate(datestring, contents, response) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/html');
  response.write('<html><body><p>Looking at ' + datestring + '</p>');
  for (var i = 0; i < contents.length; i++) {
    response.write('<a href=/' + contents[i].Key + '>' + contents[i].Key + '</a><br />');
  }
  response.end();
}

function ShowObject(key, s3object, response) {
  if (key.endsWith('.jpg')) {
    response.setHeader('Content-Type', 'image/jpeg');
  } else if (key.endsWith('.avi')) {
    response.setHeader('Content-Type', 'video/x-msvideo');
  } else {
    Show404(response);
    return;
  }
  // FIXME: videos don't display inline in Chrome.
  response.setHeader('Content-Disposition', 'inline;filename=' + key);
  response.statusCode = 200;

  s3object.on('httpData', function(chunk) { response.write(chunk); })
          .on('httpDone', function() { response.end(); })
          .on('error', function() { Show404(response); })
          .on('httpError', function() { Show404(response); })
          .send();
}

function HandlerFunction(request, response) {
  console.log(request.socket.address().address + " " +
              request.method + " " + request.url);
  var creds = auth(request);
  if (!creds ||
      !passwords[creds.name] ||
      !bcrypt.compareSync(creds.pass, passwords[creds.name])) {
    response.statusCode = 401;
    response.setHeader('WWW-Authenticate',
                       'Basic realm="camera.hioreanu.net"');
    response.end('Access denied');
    return;
  }
  response.setHeader('X-Powered-By', 'bacon');
  request.on('error', function(err) {
    console.error(err);
    response.statusCode = 500;
  }).on('data', function() {
  }).on('end', function() {
    if (request.url == '/') {
      response.statusCode = 302;
      response.setHeader('Location',
          '/' + new Date().getFullYear() +
          '/' + ("0" + (new Date().getMonth() + 1)).slice(-2) +
          '/' + ("0" + new Date().getDate()).slice(-2));
      response.end();
      return;
    }
    var matches = /\/(20[0-9][0-9])\/([0-9][0-9])\/([0-9][0-9])\/?([-.a-z0-9]*)/.exec(request.url);
    if (!matches || matches.length < 4) {
      Show404(response);
      return;
    }
    var datestring = matches[1] + '/' + matches[2] + '/' + matches[3];

    var s3 = new AWS.S3();
    if (matches.length == 5 && matches[4]) {
      var key = datestring + '/' + matches[4];
      var s3object = s3.getObject({Bucket: 'buzzercam', Key: key});
      ShowObject(key, s3object, response);
      return;
    }

    s3.listObjects({Bucket: 'buzzercam', Prefix: datestring},
                   function(err, data) {
                     if (err) {
                       Show404(response);
                       console.log("Error: " + err);
                     } else {
                       ShowDate(datestring, data.Contents, response);
                     }
                   });
    return;
  });
}

if (HTTPS_PORT) {
  var httpsopts = {
    key: fs.readFileSync('/home/hioreanu/ssl/privkey.pem'),
    cert: fs.readFileSync('/home/hioreanu/ssl/fullchain.pem'),
    ca: fs.readFileSync('/home/hioreanu/ssl/chain.pem')
  };
  var https_server = https.createServer(httpsopts, HandlerFunction);
  https_server.listen(HTTPS_PORT);
}
if (HTTP_PORT) {
  var http_server = http.createServer(HandlerFunction);
  http_server.listen(HTTP_PORT);
}
