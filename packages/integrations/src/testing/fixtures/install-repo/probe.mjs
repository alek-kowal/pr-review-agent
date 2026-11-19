// postinstall of the install fixture: records whether it could reach the network.
import { writeFileSync } from 'node:fs';

let outcome;
try {
  await fetch('https://registry.npmjs.org/', { signal: AbortSignal.timeout(5000) });
  outcome = 'reached';
} catch {
  outcome = 'failed';
}
writeFileSync('postinstall-network.txt', outcome);
