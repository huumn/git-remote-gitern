const { createLogger, format, transports } = require('winston');
const logger = createLogger({
  format: format.combine(
    format.splat(),
    format.simple()
  ),
  transports: [new transports.Console({
    // log all levels to stderr because git is reading from stdout
    stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
  })]
});

module.exports = logger