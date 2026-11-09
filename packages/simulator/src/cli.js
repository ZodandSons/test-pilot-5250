#!/usr/bin/env node
import { startSimulator } from './server.js';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : process.env[`SIM_${name.toUpperCase()}`] || def;
};

startSimulator({
  port: Number(arg('port', 2323)),
  httpPort: Number(arg('http-port', 2324)),
  systemName: arg('system', 'TPSIM01'),
}).then(() => {
  console.log('Sign on with user TESTER / password TESTER1. Ctrl+C to stop.');
});
