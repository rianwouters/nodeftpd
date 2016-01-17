import net from 'net';
import events from 'events';
import FtpConnection from './FtpConnection';
import Constants from './Constants';

var {EventEmitter} = events;

// Use LOG for brevity.
var LOG = Constants.LOG_LEVELS;

class FtpServer extends EventEmitter {
  constructor(host, options) {
    super();
    var self = this;

    self.host = host;

    self.options = options;

    if (!self.options.maxStatsAtOnce) {
      self.options.maxStatsAtOnce = 5;
    }

    if (!options.getInitialCwd) {
      throw new Error("'getInitialCwd' option of FtpServer must be set");
    }
    if (!options.getRoot) {
      throw new Error("'getRoot' option of FtpServer must be set");
    }
    self.getInitialCwd = options.getInitialCwd;
    self.getRoot = options.getRoot;

    self.getUsernameFromUid = options.getUsernameFromUid || ((uid, c) => {
      c(null, 'ftp');
    });
    self.getGroupFromGid = options.getGroupFromGid || ((gid, c) => {
      c(null, 'ftp');
    });
    self.debugging = options.logLevel || 0;
    self.useWriteFile = options.useWriteFile;
    self.useReadFile = options.useReadFile;
    self.uploadMaxSlurpSize = options.uploadMaxSlurpSize || 0;

    self.server = net.createServer();
    self.server.on('connection', (socket) => {
      self._onConnection(socket);
    });
    self.server.on('error', (err) => {
      self.emit('error', err);
    });
    self.server.on('close', () => {
      self.emit('close');
    });
  }

  _onConnection(socket) {
    // build an index for the allowable commands for this server
    var allowedCommands = null;
    if (this.options.allowedCommands) {
      allowedCommands = {};
      this.options.allowedCommands.forEach((c) => {
        allowedCommands[c.trim().toUpperCase()] = true;
      });
    }

    var conn = new FtpConnection({
      server: this,
      socket: socket,
      pasv: null, // passive listener server
      allowedCommands: allowedCommands, // subset of allowed commands for this server
      dataPort: 20,
      dataHost: null,
      dataListener: null, // for incoming passive connections
      dataSocket: null, // the actual data socket
      // True if the client has sent a PORT/PASV command, and
      // we haven't experienced a problem with the configuration
      // it specified. (This can therefore be true even if there
      // is not currently an open data connection.)
      dataConfigured: false,
      mode: 'ascii',
      filefrom: '',
      username: null,
      filename: '',
      fs: null,
      cwd: null,
      root: null,
      hasQuit: false,

      // State for handling TLS upgrades.
      secure: false,
      pbszReceived: false,
    });

    this.emit('client:connected', conn); // pass client info so they can listen for client-specific events

    socket.setTimeout(0);
    socket.setNoDelay();

    this._logIf(LOG.INFO, 'Accepted a new client connection');
    conn.respond('220 FTP server (nodeftpd) ready');

    socket.on('data', (buf) => {
      conn._onData(buf);
    });
    socket.on('end', () => {
      conn._onEnd();
    });
    socket.on('error', (err) => {
      conn._onError(err);
    });
    // `close` will always be called once (directly after `end` or `error`)
    socket.on('close', (hadError) => {
      conn._onClose(hadError);
    });
  }

  _logIf(verbosity, message, conn) {
    if (verbosity > this.debugging) {
      return;
    }
    // TODO: Move this to FtpConnection.prototype._logIf.
    var peerAddr = (conn && conn.socket && conn.socket.remoteAddress);
    if (peerAddr) {
      message = '<' + peerAddr + '> ' + message;
    }
    if (verbosity === LOG.ERROR) {
      message = 'ERROR: ' + message;
    } else if (verbosity === LOG.WARN) {
      message = 'WARNING: ' + message;
    }
    console.log(message);
    var isError = (verbosity === LOG.ERROR);
    if (isError && this.debugging === LOG.TRACE) {
      console.trace('Trace follows');
    }
  }

  listen() {
    this.server.listen(...arguments);
  }

  close() {
    this.server.close(...arguments);
  }
}

export default FtpServer;
