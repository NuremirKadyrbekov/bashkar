# Windows 11 x64: проверка тестовой службы

Это прототип для пустой тестовой машины и тестовых данных, не POS для ресторана. Нет активации, продаж, печати, резервного копирования и восстановления. Пакет содержит Windows Node.js 24.18.0, better-sqlite3 12.4.1 для ABI Node 137, WinSW 2.12.0 и сервер. Интернет и глобальный Node для запуска пакета не требуются. Проверка на Windows ещё не выполнена.

## Подготовка

Скопируйте архив на Windows 11 **x64**, распакуйте в отдельную папку. В свойствах архива Windows может потребоваться снять отметку блокировки до распаковки. Запустите Windows PowerShell **от имени администратора**, перейдите в папку распакованного архива, например:

```powershell
cd "$env:USERPROFILE\Downloads\bashkar-windows-prototype"
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsArchitecture, CsTotalPhysicalMemory
Get-FileHash .\payload\BashkarPOSPrototype.exe -Algorithm SHA256
```

Контрольная сумма включённого WinSW: `05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA`. Это сумма скачанного нами файла, а не независимая подпись производителя; доверие к файлу и цепочке поставки до пилота нужно проверить отдельно.

## Установка и старт

Скрипт рассчитан только на новую установку. Он остановится, если служба или любой из её каталогов уже существует. При ошибке не удаляйте файлы автоматически: сохраните сообщение для диагностики.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
Get-Service BashkarPOSPrototype
icacls "$env:ProgramFiles\BashkarPOSPrototype"
icacls "$env:ProgramData\BashkarPOSPrototype"
Start-Service BashkarPOSPrototype
Get-Service BashkarPOSPrototype
Invoke-RestMethod http://127.0.0.1:3210/api/v1/system/health/live
```

Ожидается `status: live`. Для `ready` HTTP 503 ожидаем: пока нет активации и рабочих операций. Чтобы прочитать ответ в Windows PowerShell 5.1:

```powershell
curl.exe -s -i http://127.0.0.1:3210/api/v1/system/health/ready
curl.exe -s http://127.0.0.1:3210/api/v1/system/version
```

Ожидается `NEEDS_ACTIVATION`, `ACTIVATION_NOT_IMPLEMENTED`, схема 1. Запишите фактические результаты и содержимое `"$env:ProgramData\BashkarPOSPrototype\logs"`, исключив личные данные.

## Остановка и перезапуск

```powershell
Stop-Service BashkarPOSPrototype
Get-Service BashkarPOSPrototype
Test-Path "$env:ProgramData\BashkarPOSPrototype\data\server.lock"
Start-Service BashkarPOSPrototype
curl.exe -s -i http://127.0.0.1:3210/api/v1/system/health/ready
```

После остановки lock-файл должен исчезнуть. Если он остался, не удаляйте его: зафиксируйте результат и выясните, завершён ли сервер. Если остановка оказалась принудительной, штатное завершение не подтверждено. Отсутствие `stopped` в серверном логе — повод расследовать. Затем перезагрузите Windows, откройте PowerShell и проверьте:

```powershell
Get-Service BashkarPOSPrototype
curl.exe -s http://127.0.0.1:3210/api/v1/system/health/live
curl.exe -s -i http://127.0.0.1:3210/api/v1/system/health/ready
```

Проверьте также выход из сеанса Windows и повторный вход. Отключение интернета проверяет только доступность этого диагностического прототипа, а не автономность продаж или активации. Не имитируйте пропажу базы или аварийную остановку на рабочем филиале.

## Отключение тестовой службы

```powershell
Stop-Service BashkarPOSPrototype
& "$env:ProgramFiles\BashkarPOSPrototype\BashkarPOSPrototype.exe" uninstall
```

Данные и исполняемые файлы скрипт не удаляет. Перед очисткой вручную убедитесь, что это именно тестовая установка и служба удалена. Автовосстановление после аварии не настроено: оставшийся lock-файл намеренно блокирует повторный запуск до ручного расследования. Перезагрузка Windows и штатный перезапуск сами по себе не подтверждают восстановление после аварии.
