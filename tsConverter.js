const path = require("path");
const { migrate, MigrateConfig } = require("ts-migrate-server");
const p = require("ts-migrate-plugins");
const plugin = require("./tsPlugin");
const { argv } = require("process");

(async () => {
  const inputDir = path.resolve(__dirname, "ts");

  let forceStop = false;

  const config = new MigrateConfig()
    .addPlugin(plugin, {
      stopper: () => {
        forceStop = true;
      },
    })
    .addPlugin({
      name: "plugin-stopper",
      run({ text }) {
        if (forceStop) {
          console.log("エラーが発生したため、処理を中断しました");
          process.exit(1);
        }
        if (argv[2] === "debug") {
          console.log("-- デバッグ終了 --");
          process.exit(0);
        }
        return text;
      },
    })
    .addPlugin(p.stripTSIgnorePlugin, {})
    .addPlugin(p.hoistClassStaticsPlugin, {})
    .addPlugin(p.declareMissingClassPropertiesPlugin, {})
    .addPlugin(p.memberAccessibilityPlugin, {})
    .addPlugin(p.addConversionsPlugin, {})
    .addPlugin(p.tsIgnorePlugin, { useTsIgnore: true });

  const exitCode = await migrate({ rootDir: inputDir, config });

  process.exit(exitCode);
})();
