#!/data/data/com.termux/files/usr/bin/sh
# Скопируйте этот файл в ~/.termux/boot/ и сделайте исполняемым.

export PATH="/data/data/com.termux/files/usr/bin:$PATH"

termux-wake-lock

# Даём телефону время подключиться к сети.
sleep 20

pm2 resurrect
