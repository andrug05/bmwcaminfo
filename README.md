# BMW Speed Camera Warning

**Основной и единственный активный проект этого репозитория** — приложение предупреждения о камерах контроля скорости для BMW MGU ID7.

Weather & Road Info больше не входит в исходный код проекта. Репозиторий используется для разработки, сборки и публикации BMW Speed Camera Warning.

## Последняя версия

**0.7.32**

- [Скачать установочный пакет MGU](https://github.com/andrug05/bmwcaminfo/releases/download/aurelm_speed_camera_warning%400.7.32/aurelm_speed_camera_warning%400.7.32.mgu)
- [Скачать архив приложения TGZ](https://github.com/andrug05/bmwcaminfo/releases/download/aurelm_speed_camera_warning%400.7.32/aurelm_speed_camera_warning%400.7.32.tgz)
- [Все релизы](https://github.com/andrug05/bmwcaminfo/releases)

## Возможности

- Работа на BMW MGU ID7.
- GPS-позиция автомобиля и предупреждение при приближении к камере.
- Локальная база камер с автономной работой после загрузки.
- Обновление базы при наличии интернет-соединения.
- Региональная база Республики Марий Эл.
- Отдельный раздел Йошкар-Олы с объединением данных из нескольких источников.
- В версии 0.7.32 включён снимок Overpass от 08.11.2026: 92 OSM-узла Йошкар-Олы, с сохранением направлений и классификацией описаний перекрёстков.
- Карта камер и отображение источника записи.
- Неполные адресные записи без подтверждённых координат не используются для GPS-предупреждений.

## Источники базы

- [SpeedCams.world](https://speedcams.world/download/russia) — основной источник.
- [OpenStreetMap](https://www.openstreetmap.org/) и [Overpass API](https://overpass-api.de/) — дополнительные данные.
- [HelpRadar](https://helpradar.ru/kamery-gibdd/ioshkar-ola), [SpeedCamOnline](https://speedcamonline.ru/map/Rus/1562/) и локальные источники — дополнительные сведения по Йошкар-Оле.

Данные OpenStreetMap распространяются по лицензии ODbL. © OpenStreetMap contributors.

## Исходный код

Каталог приложения: [bmw-speed-camera-warning](./bmw-speed-camera-warning/)

Описание, настройки базы и логика предупреждений: [README проекта](./bmw-speed-camera-warning/README.md)

## Сборка

GitHub Actions → **Build BMW Speed Camera Warning**.

Запуск сборки вручную: Actions → Build BMW Speed Camera Warning → Run workflow. По умолчанию используется версия 0.7.32.
