// Subprocess entry used solely by revisionConcurrency.test.ts.
import { LocalResumeStore, LocalFsApiError } from './localFsApi';
const [dir, expectedRevision, title] = process.argv.slice(2);
if (!dir || !expectedRevision || !title) process.exit(2);
try {
  const store = new LocalResumeStore(dir);
  const current = await store.getResume('demo');
  const saved = await store.saveResume('demo', {...current, title}, {expectedRevision, snapshotReason:'synthetic process race'});
  process.stdout.write(saved.title + '\n');
} catch (err) {
  if (err instanceof LocalFsApiError && err.code === 'REVISION_CONFLICT') {
    process.stdout.write(err.code + '\n'); process.exitCode = 3;
  } else {
    process.stderr.write(String(err) + '\n'); process.exitCode = 2;
  }
}
