import config from '@tuomashatakka/eslint-config'


export default [
  ...config,
  {
    rules: {
      'react-strict/jsx-prop-layout': 'off',
    },
  },
]
