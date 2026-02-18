import path from 'path';

// Path to the headless Kotlin/JS bundle
const BUNDLE_PATH = path.resolve(
  __dirname,
  '../../headless/build/productionLibrary/MonoSketch-headless.js'
);

let kotlinModule: any = null;

export function loadKotlinBundle(): void {
  try {
    kotlinModule = require(BUNDLE_PATH);
  } catch (err) {
    throw new Error(
      `Failed to load Kotlin/JS bundle at ${BUNDLE_PATH}. ` +
      `Run './gradlew :headless:assemble' first. Error: ${err}`
    );
  }
}

export function createDiagramSession(): any {
  if (!kotlinModule) {
    throw new Error('Kotlin bundle not loaded. Call loadKotlinBundle() first.');
  }
  const DiagramSession = kotlinModule.mono.headless.DiagramSession;
  return new DiagramSession();
}
