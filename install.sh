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
RAW_URL="https://raw.githubusercontent.com/$REPO/main/install.sh"

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

# ارقام فارسی/عربی را به لاتین تبدیل و فاصله‌ها را حذف می‌کند
normalize_digits() {
  local s="$1"
  s="${s//۰/0}"; s="${s//۱/1}"; s="${s//۲/2}"; s="${s//۳/3}"; s="${s//۴/4}"
  s="${s//۵/5}"; s="${s//۶/6}"; s="${s//۷/7}"; s="${s//۸/8}"; s="${s//۹/9}"
  s="${s//٠/0}"; s="${s//١/1}"; s="${s//٢/2}"; s="${s//٣/3}"; s="${s//٤/4}"
  s="${s//٥/5}"; s="${s//٦/6}"; s="${s//٧/7}"; s="${s//٨/8}"; s="${s//٩/9}"
  s="${s//،/,}"                      # ویرگول فارسی
  s="${s//[[:space:]]/}"             # حذف فاصله‌های چسبیده به مقدار
  printf '%s' "$s"
}

# نام متغیرهای محلی عمداً با پیشوند __ask_ است تا با نام متغیری که
# فراخواننده پاس می‌دهد تداخل پیدا نکند (bash از scope پویا استفاده می‌کند).
ask() { # ask <متن> <متغیر> [پیش‌فرض]
  local __ask_prompt="$1" __ask_var="$2" __ask_def="${3:-}" __ask_val=""
  while :; do
    if [[ -n "$__ask_def" ]]; then
      read -r -u 3 -p "$__ask_prompt [$__ask_def]: " __ask_val
      __ask_val="${__ask_val:-$__ask_def}"
    else
      read -r -u 3 -p "$__ask_prompt: " __ask_val
    fi
    [[ -n "$__ask_val" ]] && { printf -v "$__ask_var" '%s' "$__ask_val"; return; }
    echo "  ↳ این مقدار الزامی است."
  done
}
ask_ids() { # فقط عدد و کاما
  local __ids_prompt="$1" __ids_var="$2" __ids_def="${3:-}" __ids_val=""
  while :; do
    ask "$__ids_prompt" __ids_val "$__ids_def"
    __ids_val="$(normalize_digits "$__ids_val")"
    [[ "$__ids_val" =~ ^[0-9]+(,[0-9]+)*$ ]] && { printf -v "$__ids_var" '%s' "$__ids_val"; return; }
    echo "  ↳ فقط آی‌دی عددی (چند تا را با کاما جدا کنید)."
  done
}
ask_num() { # فقط عدد صحیح مثبت
  local __num_prompt="$1" __num_var="$2" __num_def="${3:-}" __num_val=""
  while :; do
    ask "$__num_prompt" __num_val "$__num_def"
    __num_val="$(normalize_digits "$__num_val")"
    [[ "$__num_val" =~ ^[0-9]+$ && "$__num_val" -gt 0 ]] \
      && { printf -v "$__num_var" '%s' "$__num_val"; return; }
    echo "  ↳ فقط عدد صحیح بزرگ‌تر از صفر."
  done
}

ENV_FILE="$APP_DIR/.env"

# خواندن یک کلید از .env موجود (بدون source کردن، تا مقادیر عجیب خطر نسازند)
env_get() { # env_get <کلید>
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1
}

# پوشاندن توکن هنگام نمایش
mask() { local t="$1"; [[ ${#t} -gt 14 ]] && printf '%s…%s' "${t:0:10}" "${t: -4}" || printf '%s' "$t"; }

echo "════════ نصب ربات رزرو بیت‌الحسین ════════"
echo

# ---------- تنظیمات موجود ----------
# در آپدیت، مقادیر قبلی حفظ می‌شوند و دوباره پرسیده نمی‌شوند.
BOT_TOKEN="$(env_get BOT_TOKEN)"
SUPER_IDS="$(env_get SUPER_ADMIN_IDS)"
NAJAF_IDS="$(env_get ADMIN_NAJAF_IDS)"
KARBALA_IDS="$(env_get ADMIN_KARBALA_IDS)"
CAP_NM="$(env_get CAP_NAJAF_MEN)";    CAP_NW="$(env_get CAP_NAJAF_WOMEN)"
CAP_KM="$(env_get CAP_KARBALA_MEN)";  CAP_KW="$(env_get CAP_KARBALA_WOMEN)"
MAX_NIGHTS="$(env_get MAX_NIGHTS)"
MAX_AHEAD="$(env_get MAX_DAYS_AHEAD)"
MAX_PER="$(env_get MAX_PER_BOOKING)"
# کلیدهایی که پرسیده نمی‌شوند ولی نباید در آپدیت پاک شوند
CHAT_NAJAF="$(env_get ADMIN_CHAT_NAJAF)"
CHAT_KARBALA="$(env_get ADMIN_CHAT_KARBALA)"
API_ROOT="$(env_get TELEGRAM_API_ROOT)"

if [[ -n "${BH_RECONFIGURE:-}" ]]; then
  echo "▸ BH_RECONFIGURE فعال است — همه تنظیمات دوباره پرسیده می‌شود."
  echo
  BOT_TOKEN=""; SUPER_IDS=""; NAJAF_IDS=""; KARBALA_IDS=""
elif [[ -f "$ENV_FILE" ]]; then
  echo "▸ تنظیمات قبلی در $ENV_FILE پیدا شد و حفظ می‌شود:"
  echo "    توکن ربات   : $(mask "$BOT_TOKEN")"
  echo "    ادمین کل    : ${SUPER_IDS:-—}"
  echo "    ادمین نجف   : ${NAJAF_IDS:-—}"
  echo "    ادمین کربلا : ${KARBALA_IDS:-—}"
  echo "    ظرفیت نجف   : ${CAP_NM:-—} آقا / ${CAP_NW:-—} خانم"
  echo "    ظرفیت کربلا : ${CAP_KM:-—} آقا / ${CAP_KW:-—} خانم"
  echo
  echo "  برای تغییر آنها این‌گونه اجرا کنید:"
  echo "    curl -fsSL $RAW_URL | sudo BH_RECONFIGURE=1 bash"
  echo "  یا مستقیم: nano $ENV_FILE  &&  systemctl restart bh-bot"
  echo
fi

# ---------- پرسش‌ها (فقط برای مقادیری که هنوز تنظیم نشده‌اند) ----------
while [[ ! "$BOT_TOKEN" =~ ^[0-9]{6,15}:[A-Za-z0-9_-]{30,}$ ]]; do
  [[ -n "$BOT_TOKEN" ]] && echo "  ↳ فرمت توکن درست نیست (مثل 123456789:AAH...)."
  ask "🔑 توکن ربات از BotFather" BOT_TOKEN
  BOT_TOKEN="${BOT_TOKEN//[[:space:]]/}"
done

if [[ -z "$SUPER_IDS" || -z "$NAJAF_IDS" || -z "$KARBALA_IDS" ]]; then
  echo
  echo "آی‌دی عددی را از ربات @userinfobot بگیرید."
  [[ -n "$SUPER_IDS"   ]] || ask_ids "👑 آی‌دی ادمین کل (تایید هر دو شهر + گزارش)" SUPER_IDS
  [[ -n "$NAJAF_IDS"   ]] || ask_ids "🕌 آی‌دی ادمین نجف"   NAJAF_IDS   "$SUPER_IDS"
  [[ -n "$KARBALA_IDS" ]] || ask_ids "🕌 آی‌دی ادمین کربلا" KARBALA_IDS "$SUPER_IDS"
fi

if [[ -z "$CAP_NM" || -z "$CAP_NW" || -z "$CAP_KM" || -z "$CAP_KW" ]]; then
  echo
  echo "ظرفیت شبانه هر شهر:"
  [[ -n "$CAP_NM" ]] || ask_num "  نجف — آقا"    CAP_NM 40
  [[ -n "$CAP_NW" ]] || ask_num "  نجف — خانم"   CAP_NW 40
  [[ -n "$CAP_KM" ]] || ask_num "  کربلا — آقا"  CAP_KM 40
  [[ -n "$CAP_KW" ]] || ask_num "  کربلا — خانم" CAP_KW 40
fi

if [[ -z "$MAX_NIGHTS" || -z "$MAX_AHEAD" || -z "$MAX_PER" ]]; then
  echo
  [[ -n "$MAX_NIGHTS" ]] || ask_num "حداکثر شب اقامت"        MAX_NIGHTS 7
  [[ -n "$MAX_AHEAD"  ]] || ask_num "حداکثر روز رزرو جلوتر"   MAX_AHEAD 120
  [[ -n "$MAX_PER"    ]] || ask_num "حداکثر نفرات در هر رزرو" MAX_PER 10
fi
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
# نسخه قبلی .env نگه داشته می‌شود تا اگر چیزی خراب شد قابل برگشت باشد
[[ -f "$ENV_FILE" ]] && cp -a "$ENV_FILE" "$ENV_FILE.bak"

cat > "$ENV_FILE" <<EOF
BOT_TOKEN=$BOT_TOKEN
SUPER_ADMIN_IDS=$SUPER_IDS
ADMIN_NAJAF_IDS=$NAJAF_IDS
ADMIN_KARBALA_IDS=$KARBALA_IDS
ADMIN_CHAT_NAJAF=$CHAT_NAJAF
ADMIN_CHAT_KARBALA=$CHAT_KARBALA
TELEGRAM_API_ROOT=$API_ROOT
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
