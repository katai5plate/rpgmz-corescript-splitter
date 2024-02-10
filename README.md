# rpgmz-corescript-splitter

ツクール MZ のコアスクリプトをクラスごとに分割し、型定義ファイルを自動生成するバッチ

## Usage

1. `npm i`
2. `js/` に新規作成したツクール MZ の `js/` を上書き
3. `npm run extract`
4. `npm run ts`
5. 出来上がり

## Result

- `src/` には、クラスごとに分割された JS が読みやすく自動整形され出力されます
- `ts/` には、`src/` を TypeScript に変換されたものが出力されます
- `types/` には `ts/` を元に生成された型定義ファイルが出力されます
