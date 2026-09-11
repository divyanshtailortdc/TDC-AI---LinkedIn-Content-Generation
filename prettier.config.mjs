/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
const config = {
  plugins: ['prettier-plugin-organize-imports', 'prettier-plugin-tailwindcss'],
  arrowParens: 'avoid',
  trailingComma: 'none',
  semi: false,
  singleQuote: true,
  tabWidth: 2
}

export default config
