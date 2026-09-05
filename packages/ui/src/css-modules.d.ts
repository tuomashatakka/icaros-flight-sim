// CSS modules, for the standalone typecheck of this package. Next supplies the
// same declaration to the app through next-env.d.ts.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>

  export default classes
}
