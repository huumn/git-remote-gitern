const { createLogger, format, transports } = require('winston');
const logger = createLogger({
  levels: {
    error: 0, 
    warn: 1, 
    info: 2, 
    verbose: 3, 
    debug: 4, 
    silly: 5
  },
  format: format.combine(
    format.splat(),
    format.simple()
  ),
  transports: [new transports.Console({
    // log all levels to stderr because git is reading from stdout
    stderrLevels: ['error', 'warn', 'info', 'verbose', 'debug', 'silly'],
  })]
});

module.exports = logger