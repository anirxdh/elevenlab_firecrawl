const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: {
    background: './src/background/service-worker.ts',
    content: './src/content/content-script.ts',
    offscreen: './src/offscreen/offscreen.ts',
    welcome: './src/welcome/welcome-entry.tsx',
    popup: './src/popup/popup-entry.tsx',
    settings: './src/settings/settings-entry.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'public/icons', to: 'icons' },
        { from: 'public/offscreen.html', to: 'offscreen.html' },
      ],
    }),
    new HtmlWebpackPlugin({
      template: './src/welcome/welcome.html',
      filename: 'welcome.html',
      chunks: ['welcome'],
    }),
    new HtmlWebpackPlugin({
      template: './src/popup/popup.html',
      filename: 'popup.html',
      chunks: ['popup'],
    }),
    new HtmlWebpackPlugin({
      template: './src/settings/settings.html',
      filename: 'settings.html',
      chunks: ['settings'],
    }),
  ],
};
