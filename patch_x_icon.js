const fs = require('fs');
let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');

code = code.replace(
  `} from 'lucide-react';`,
  `  X\n} from 'lucide-react';`
);

fs.writeFileSync('components/WorkflowApp.tsx', code);
