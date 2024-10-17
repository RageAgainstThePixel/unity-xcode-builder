
import core = require('@actions/core');

export function log(message: string, type: 'info' | 'warning' | 'error' = 'info') {
    if (type == 'info' && !core.isDebug()) { return; }
    const lines = message.split('\n');
    let first = true;
    for (const line of lines) {
        if (first) {
            first = false;
            switch (type) {
                case 'info':
                    core.info(line);
                    break;
                case 'warning':
                    core.warning(line);
                    break;
                case 'error':
                    core.error(line);
                    break;
            }
        } else {
            core.info(line);
        }
    }
}
