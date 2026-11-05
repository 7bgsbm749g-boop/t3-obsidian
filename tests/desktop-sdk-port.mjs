import {registerHooks} from 'node:module';
// Direct Node tests execute isolated desktop adapters without the Obsidian host.
// Supply only platform flags. The portable send-preview state tests can also
// import the SDK namespace; rendering stays unavailable here and requires a
// real VM/native fixture. VM/mobile tests keep their own explicit SDK port.
const desktopPlatform=new URL('./fixtures/desktop-sdk.cjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
  if(specifier==='obsidian'&&context.parentURL&&(/\/src\/.*(?:-desktop|\/desktop(?:-[^/]+)?)\.ts$/.test(context.parentURL)||context.parentURL.includes('/tests/fixtures/baseline-native/')||context.parentURL.endsWith('/src/responses/send-preview.ts')))return {url:desktopPlatform,shortCircuit:true};
  return next(specifier,context);
}});
