#!/usr/bin/env bash
# نصب‌کننده ربات بیت‌الحسین — اجرا با: sudo bash install.sh
set -euo pipefail

APP_DIR=/opt/bh-bot
APP_USER=bhbot
_SELF="${BASH_SOURCE[0]:-}"
if [[ -n "$_SELF" && -f "$_SELF" ]]; then
  SRC_DIR="$(cd "$(dirname "$_SELF")" && pwd)"
else
  SRC_DIR=""   # از طریق لوله (curl | bash) اجرا شده است
fi
REPO="${BH_REPO:-For256256/Samanak}"

# اگر اسکریپت تنها اجرا شده (مثلاً از طریق curl)، سورس را از گیت‌هاب بگیر
if [[ ! -d "$SRC_DIR/src" ]]; then
  [[ -n "$REPO" ]] || { echo "❌ متغیر BH_REPO تنظیم نشده (مثال: BH_REPO=user/bh-bot)"; exit 1; }
  command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl; }
  TMP="$(mktemp -d)"
  echo "▸ دریافت سورس از github.com/$REPO ..."
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" | tar -xz -C "$TMP"
  SRC_DIR="$(find "$TMP" -maxdepth 2 -name src -type d | head -1 | xargs dirname)"
  [[ -d "$SRC_DIR/src" ]] || { echo "❌ سورس پیدا نشد."; exit 1; }
fi

[[ $EUID -eq 0 ]] || { echo "❌ با sudo اجرا کنید."; exit 1; }
exec 3</dev/tty || { echo "❌ ترمینال تعاملی لازم است."; exit 1; }

ask() { # ask <متن> <متغیر> [پیش‌فرض]
  local prompt="$1" var="$2" def="${3:-}" val=""
  while :; do
    if [[ -n "$def" ]]; then read -r -u 3 -p "$prompt [$def]: " val; val="${val:-$def}"
    else read -r -u 3 -p "$prompt: " val; fi
    [[ -n "$val" ]] && { printf -v "$var" '%s' "$val"; return; }
    echo "  ↳ این مقدار الزامی است."
  done
}
ask_ids() { # فقط عدد و کاما
  local prompt="$1" var="$2" def="${3:-}" val=""
  while :; do
    ask "$prompt" val "$def"
    [[ "$val" =~ ^[0-9]+(,[0-9]+)*$ ]] && { printf -v "$var" '%s' "$val"; return; }
    echo "  ↳ فقط آی‌دی عددی (چند تا را با کاما جدا کنید)."
  done
}

echo "════════ نصب ربات رزرو بیت‌الحسین ════════"
echo

# ---------- پرسش‌ها ----------
while :; do
  ask "🔑 توکن ربات از BotFather" BOT_TOKEN
  [[ "$BOT_TOKEN" =~ ^[0-9]{6,15}:[A-Za-z0-9_-]{30,}$ ]] && break
  echo "  ↳ فرمت توکن درست نیست (مثل 123456789:AAH...)."
done
echo
echo "آی‌دی عددی را از ربات @userinfobot بگیرید."
ask_ids "👑 آی‌دی ادمین کل (تایید هر دو شهر + گزارش)" SUPER_IDS
ask_ids "🕌 آی‌دی ادمین نجف"   NAJAF_IDS  "$SUPER_IDS"
ask_ids "🕌 آی‌دی ادمین کربلا" KARBALA_IDS "$SUPER_IDS"
echo
echo "ظرفیت شبانه هر شهر:"
ask "  نجف — آقا"   CAP_NM 40
ask "  نجف — خانم"  CAP_NW 40
ask "  کربلا — آقا"  CAP_KM 40
ask "  کربلا — خانم" CAP_KW 40
echo
ask "حداکثر شب اقامت"          MAX_NIGHTS 7
ask "حداکثر روز رزرو جلوتر"     MAX_AHEAD 120
ask "حداکثر نفرات در هر رزرو"   MAX_PER 10
echo

# ---------- پیش‌نیازها ----------
echo "▸ نصب پیش‌نیازها..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates build-essential python3 sqlite3 >/dev/null
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "  Node $(node -v)"

# ---------- کاربر و فایل‌ها ----------
id -u "$APP_USER" &>/dev/null || useradd -r -m -d "$APP_DIR" -s /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"/data
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  cp -r "$SRC_DIR"/src "$SRC_DIR"/scripts "$SRC_DIR"/deploy "$SRC_DIR"/package.json "$APP_DIR"/
  for f in README.md package-lock.json .env.example; do
    [[ -f "$SRC_DIR/$f" ]] && cp "$SRC_DIR/$f" "$APP_DIR"/ || true
  done
fi

# ---------- تنظیمات ----------
cat > "$APP_DIR/.env" <<EOF
BOT_TOKEN=$BOT_TOKEN
SUPER_ADMIN_IDS=$SUPER_IDS
ADMIN_NAJAF_IDS=$NAJAF_IDS
ADMIN_KARBALA_IDS=$KARBALA_IDS
ADMIN_CHAT_NAJAF=
ADMIN_CHAT_KARBALA=
DB_PATH=$APP_DIR/data/bot.db
MAX_NIGHTS=$MAX_NIGHTS
MAX_DAYS_AHEAD=$MAX_AHEAD
MAX_PER_BOOKING=$MAX_PER
CAP_NAJAF_MEN=$CAP_NM
CAP_NAJAF_WOMEN=$CAP_NW
CAP_KARBALA_MEN=$CAP_KM
CAP_KARBALA_WOMEN=$CAP_KW
EOF
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "▸ نصب وابستگی‌ها..."
sudo -u "$APP_USER" env HOME="$APP_DIR" bash -c "cd '$APP_DIR' && npm install --omit=dev --silent"

echo "▸ اجرای تست..."
sudo -u "$APP_USER" env HOME="$APP_DIR" \
  DB_PATH="$APP_DIR/data/selftest.db" \
  SUPER_ADMIN_IDS=111 ADMIN_NAJAF_IDS=222 ADMIN_KARBALA_IDS=333 \
  CAP_NAJAF_MEN=40 CAP_NAJAF_WOMEN=40 CAP_KARBALA_MEN=40 CAP_KARBALA_WOMEN=40 \
  bash -c "cd '$APP_DIR' && node scripts/selftest.js"
rm -f "$APP_DIR"/data/selftest.db*

echo "▸ بررسی دسترسی به تلگرام..."
if ! curl -s --max-time 10 -o /dev/null "https://api.telegram.org/bot$BOT_TOKEN/getMe"; then
  echo "  ⚠️ سرور به api.telegram.org دسترسی ندارد. اگر سرور داخل ایران است، ربات کار نخواهد کرد."
else
  NAME=$(curl -s --max-time 10 "https://api.telegram.org/bot$BOT_TOKEN/getMe" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
  echo "  ✅ ربات شناسایی شد: @$NAME"
fi

# ---------- سرویس ----------
cp "$APP_DIR/deploy/bh-bot.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bh-bot
sleep 3

echo
if systemctl is-active --quiet bh-bot; then
  echo "✅ نصب کامل شد. ربات در حال اجراست."
else
  echo "⚠️ سرویس بالا نیامد. لاگ:"; journalctl -u bh-bot -n 20 --no-pager
fi
echo
echo "لاگ زنده:      journalctl -u bh-bot -f"
echo "ری‌استارت:     systemctl restart bh-bot"
echo "تغییر تنظیمات: nano $APP_DIR/.env  && systemctl restart bh-bot"
