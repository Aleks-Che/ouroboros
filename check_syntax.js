var fs = require('fs');
var code = fs.readFileSync('web/modules/settings_ui.js', 'utf8');
try {
  new Function(code.replace(/import\s+.*?from\s+['"].*?['"]/g, ''));
  console.log('OK');
} catch (e) {
  console.log('ERR: ' + e.message);
}
