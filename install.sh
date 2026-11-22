#!/usr/bin/env bash
# dsh-coupon 安装脚本（幂等）
#
# 做什么：
#   1. 把插件文件复制到 profile 的 node_modules/dsh-coupon（**复制而不是软链**：
#      软链会让 Node 按真实路径解析依赖，可能找不到 @deepseek-ai/dsh-tools）
#   2. 在 profile package.json 的 dsh.profile.bundles 里补一行 dsh-coupon
#   3. 语法 / 加载自检
#
# 装完需要重启 DSH web 进程生效（宿主插件不能热加载）。
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"
DEST="$PROFILE/node_modules/dsh-coupon"
PKG="$PROFILE/package.json"

if [ ! -d "$PROFILE" ]; then
  echo "profile 不存在：$PROFILE（可用 DSH_PROFILE_DIR 指定）" >&2
  exit 1
fi

mkdir -p "$DEST"

# 改 package.json 前先留底（只留第一次的那份）
if [ ! -f "$PKG.bak-dsh-coupon" ]; then
  cp -a "$PKG" "$PKG.bak-dsh-coupon"
  echo "已备份：$PKG.bak-dsh-coupon"
fi

for f in index.js store.js hostdeps.mjs client.js package.json cordis.patch.yml README.md LICENSE; do
  [ -f "$SRC/$f" ] && cp -f "$SRC/$f" "$DEST/$f"
done
mkdir -p "$DEST/assets"
[ -f "$SRC/assets/note.jpg" ] && cp -f "$SRC/assets/note.jpg" "$DEST/assets/note.jpg"
echo "已复制到 $DEST"

# 修补 bundles 列表（用 node 改 JSON，保留 2 空格缩进）
node - "$PKG" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = (pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || [])
if (!bundles.includes('dsh-coupon')) {
  bundles.push('dsh-coupon')
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log('bundles 已追加 dsh-coupon')
} else {
  console.log('bundles 已包含 dsh-coupon，跳过')
}
NODE

node --check "$DEST/index.js"
node --check "$DEST/client.js"
node --check "$DEST/store.js"

# 加载自检：在 profile 目录下 import，确认依赖能解析
( cd "$PROFILE" && node --input-type=module -e "
import('$DEST/index.js')
  .then((m) => { console.log('加载自检 OK：name=' + m.name + ' inject=' + JSON.stringify(m.inject)) })
  .catch((e) => { console.error('加载自检失败：' + e.message); process.exit(1) })
" )

cat <<'TIP'

装好了。重启 DSH web 进程后生效（宿主插件不能热加载）：
  停掉当前 dsh web，再重新启动即可。

回滚：
  从 profile package.json 的 dsh.profile.bundles 删掉 "dsh-coupon"，再 rm -rf 本目录，重启。

钱包数据在 ~/wallet/（或 $DSH_WALLET_DIR），卸载不影响。
TIP
