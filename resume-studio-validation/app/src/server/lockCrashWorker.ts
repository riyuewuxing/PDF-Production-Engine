import {withResumeWriteLock} from './localFsApi';
const dir=process.argv[2];
if(!dir)process.exit(2);
void withResumeWriteLock(dir,async()=>{process.exit(7);});
