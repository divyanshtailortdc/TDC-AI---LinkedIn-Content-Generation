declare module '*.css'

// Single lucide icons, whose drawing data the canvas renderer reads directly
// (src/lib/media/canvas/icons.ts). The package publishes no types for them.
declare module 'lucide-react/dist/esm/icons/*.mjs' {
  export const __iconData: {
    name: string
    node: Array<[tag: string, attributes: Record<string, string>]>
  }
}
