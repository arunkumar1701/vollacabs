const fs = require('fs');
let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');

code = code.replace(
  `Database as DBIcon\n  X\n} from 'lucide-react';`,
  `Database as DBIcon,\n  X\n} from 'lucide-react';`
);

fs.writeFileSync('components/WorkflowApp.tsx', code);
