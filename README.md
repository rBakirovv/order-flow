# OrderFlow

Учебный проект по брокерам сообщений: NestJS, TypeScript, PostgreSQL и Prisma.
**Этап 1 завершён:** синхронный REST API заказов с имитацией email на 3 секунды.
Одно NestJS-приложение, модульный монолит. Этап 2 выполняется по шагам:
добавлены инфраструктура RabbitMQ, producer и отдельный email worker.

## Критерии приёмки этапа 1

- [x] Приложение и PostgreSQL запускаются по командам ниже.
- [x] Работают `POST /orders` и `GET /orders/:id`.
- [x] DTO валидируются; ошибки возвращают `400`, `404` и `409`.
- [x] Цены берутся из БД, в позиции заказа сохраняется историческая цена.
- [x] Создание заказа и списание остатков выполняются атомарно.
- [x] Конкурентные запросы не создают отрицательных остатков.
- [x] Email имитируется после коммита и задерживает HTTP-ответ примерно на 3 секунды.
- [x] Есть воспроизводимые миграции, seed и автоматизированные тесты основных сценариев.
- [x] Результаты замеров и выводы записаны в [docs/observations.md](docs/observations.md).

Итоговая проверка выполнена 5 ноября 2026 года: 47 e2e-проверок на реальном
PostgreSQL, 1 unit-тест, сборка, lint, проверка типов и Prisma schema прошли.
Дополнительно проверен запуск собранного приложения с пустой временной БД.

## Project setup

Для локального запуска нужны Node.js 24 LTS, npm и работающий Docker Compose.
NestJS запускается на компьютере, PostgreSQL и RabbitMQ — в Docker.

```bash
npm ci
cp .env.example .env
```

Задайте собственный `POSTGRES_PASSWORD` и обновите пароль в `DATABASE_URL`.
Порт, имя базы и пользователь в URL должны совпадать с `POSTGRES_*`.
Специальные символы в имени пользователя и пароле нужно URL-кодировать.
Не перезаписывайте существующий `.env`: он может содержать ключи Observe.
Также задайте собственный `RABBITMQ_PASSWORD` и обновите пароль в `RABBITMQ_URL`.
Если `.env` уже существует, добавьте недостающие `RABBITMQ_*` из `.env.example`
вручную, сохранив остальные настройки.

## PostgreSQL в Docker

Настройки находятся в `.env`: имя проекта, образ, имя контейнера, внешний порт,
база, пользователь и пароль. `.env` исключён из Git.
Запуск базы (Docker должен быть запущен):

```bash
docker compose up -d --wait
docker compose ps
```

Для подключения с компьютера используйте адрес `127.0.0.1` и `POSTGRES_PORT`,
`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` из `.env`.
Из других сервисов в той же Docker-сети адрес базы — `postgres:5432`.
Имена сети и тома Docker Compose формирует из `COMPOSE_PROJECT_NAME`.

```bash
# Открыть psql в контейнере
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Остановить контейнеры, сохранив данные в томе
docker compose down
```

Данные сохраняются при пересоздании контейнера. `docker compose down -v` удаляет
том вместе с данными. Имя базы, пользователь и пароль применяются при первом
запуске с пустым томом; изменение `.env` не меняет их в существующей базе.
NestJS подключается через Prisma по `DATABASE_URL`. `.env` загружается при старте
приложения и команд Prisma; переменные окружения процесса имеют приоритет.

## RabbitMQ в Docker — этап 2

Используется образ `rabbitmq:4.4.0-management` с Management UI.
Брокер будет хранить задачи отправки email, а UI позволит наблюдать за очередью.
Порты опубликованы только на `127.0.0.1`: `5672` для AMQP и `15672` для UI.
Образ, порты и учётные данные задаются через `RABBITMQ_*` в `.env`.
Пароль не хранится в Compose; `change_me` в примере нужно заменить.

После добавления настроек в `.env`:

```bash
# Проверить конфигурацию без вывода паролей
docker compose config --quiet

# Запустить только брокер (или все сервисы: docker compose up -d --wait)
docker compose up -d --wait rabbitmq
docker compose ps rabbitmq
docker compose exec rabbitmq rabbitmq-diagnostics -q check_running

# Посмотреть логи при проблемах запуска
docker compose logs --tail=100 rabbitmq
```

Откройте [Management UI](http://127.0.0.1:15672) и войдите с `RABBITMQ_USER`
и `RABBITMQ_PASSWORD`. При изменении `RABBITMQ_MANAGEMENT_PORT` используйте
выбранный порт. На Overview должен отображаться работающий узел RabbitMQ.
Очередь `email.notifications` объявляется producer при первой публикации
с параметром `durable: true`. После создания первого заказа она появится на Queues.

API и worker подключаются по `RABBITMQ_URL`.
Из Docker-сети адрес брокера — `rabbitmq:5672`. При изменении пользователя,
пароля или AMQP-порта обновляйте URL; специальные символы в учётных данных
URL-кодируйте. Соединение создаётся при первой публикации и используется повторно.
После закрытия соединения следующая публикация попробует подключиться заново.

Данные RabbitMQ хранятся в отдельном томе `rabbitmq_data`. Фиксированный hostname
сохраняет имя узла при пересоздании контейнера. `docker compose down` сохраняет
данные обоих сервисов; `docker compose down -v` удаляет тома и PostgreSQL,
и RabbitMQ. Начальные учётные данные RabbitMQ применяются только к пустому
хранилищу: изменение `.env` не меняет пароль существующего пользователя.

## Модель данных, миграции и seed

В `prisma/schema.prisma` описаны `Product`, `Order` и `OrderItem`.
Денежные значения хранятся как `Int` в копейках. `OrderItem.unitPrice` хранит
цену на момент заказа; изменение `Product.price` не меняет сохранённую позицию.
Статус заказа по умолчанию — `CREATED`, время создания задаёт PostgreSQL.

Применение сохранённых миграций и загрузка учебного каталога:

```bash
docker compose up -d --wait
npm run db:deploy
npm run db:seed
```

`db:deploy` применяет только существующие миграции без сброса БД. Для создания
новой миграции после изменения схемы в локальной разработке:

```bash
npm run db:migrate -- --name describe_change
npm run db:generate
```

В Prisma 7 генерация клиента и seed запускаются отдельно от миграций.
`db:seed` сначала генерирует клиент, затем выполняет `prisma/seed.ts` через `tsx`;
команда настроена в `prisma.config.ts`, как описано в
[документации Prisma](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding).

Seed добавляет пять товаров с фиксированными ID 1–5 (эти ID зарезервированы
для учебного каталога). Уже существующие записи с такими ID пропускаются:
повторный запуск не сбрасывает цены и остатки и не создаёт дубликатов.
Последовательность ID корректируется для последующего создания товаров.
Запускайте seed при подготовке локальной БД до обработки запросов.

| ID  | Товар   | Цена, коп. | Остаток |
| --- | ------- | ---------- | ------- |
| 1   | Блокнот | 25000      | 20      |
| 2   | Ручка   | 5000       | 100     |
| 3   | Кружка  | 75000      | 5       |
| 4   | Рюкзак  | 350000     | 1       |
| 5   | Термос  | 150000     | 0       |

Открыть Prisma Studio для просмотра и редактирования данных (PostgreSQL должен
быть запущен; подключение берётся из `DATABASE_URL`):

```bash
npm run db:studio
```

Проверить таблицы и seed можно через `psql` (команда подключения приведена выше):

```sql
\dt
SELECT id, name, price, stock FROM "Product" ORDER BY id;
```

SQL миграции содержит `CHECK`-ограничения: название не пустое после удаления
крайних пробелов, цена и количество положительные, остаток и сумма заказа
неотрицательные. В Prisma schema эти ограничения не выражаются, поэтому их
нужно сохранять в SQL будущих миграций. Внешние ключи запрещают удалять заказ
или товар, пока на них ссылаются позиции. Пара `orderId + productId` уникальна.
Сумму рассчитывает сервис заказов; непустой массив позиций проверяется DTO.

## Compile and run the project

```bash
docker compose up -d --wait
npm run db:deploy
npm run db:seed

# development
npm run start

# watch mode
npm run start:dev

# production mode
npm run build
npm run start:prod
```

Prisma Client генерируется автоматически перед сборкой, запуском в режиме
разработки и командами `test` / `test:e2e`. Для ручной генерации:

```bash
npm run db:generate
```

При запуске `PrismaService` выполняет настоящий запрос `SELECT 1`. После сообщения
`Connected to PostgreSQL` приложение начинает слушать `PORT` (по умолчанию 3000).
Если `DATABASE_URL` не задан или БД недоступна, приложение завершается с ошибкой.
При SIGINT/SIGTERM соединения с БД закрываются через shutdown hooks NestJS.

Проверка работающего HTTP-сервера:

```bash
curl -i http://localhost:3000/
```

Ожидается `200 OK` и `Hello World!`.
Конфигурация клиента соответствует [Prisma ORM 7](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators).

## Создание заказа

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerEmail":"user@example.com","items":[{"productId":1,"quantity":2},{"productId":3,"quantity":1}]}'
```

На свежем seed ожидается `201 Created` и ответ (ID иллюстративный):

```json
{
  "id": 1,
  "customerEmail": "user@example.com",
  "status": "CREATED",
  "totalAmount": 125000,
  "items": [
    { "productId": 1, "quantity": 2, "unitPrice": 25000 },
    { "productId": 3, "quantity": 1, "unitPrice": 75000 }
  ]
}
```

Цены берутся из БД. Email должен быть валидным, массив позиций — непустым,
ID товаров и количества — положительными целыми числами. Повторяющиеся товары,
строки вместо чисел и дополнительные поля (в том числе цены) отклоняются с `400`.
Входные ID, количества и итоговая сумма ограничены максимумом PostgreSQL `INTEGER`
(`2147483647`); превышение возвращает `400`.

Несуществующий товар возвращает `404`, недостаточный остаток — `409`.
Все позиции обрабатываются в одной транзакции; при ошибке изменения откатываются.
Списание выполняется условным обновлением `stock >= quantity` с проверкой числа
изменённых строк. Это защищает остатки при конкурентных запросах.
Товары блокируются в порядке ID, независимо от порядка позиций во входном запросе;
позиции в ответе также отсортированы по ID товара.

Валидация зарегистрирована через `APP_PIPE`, поэтому используется одинаково
при обычном запуске и в e2e-тестах. Настройки соответствуют
[ValidationPipe NestJS](https://docs.nestjs.com/application/validation).

## Публикация уведомления — шаг 3

После коммита заказа `OrdersService` вызывает с `await` метод
`NotificationsService.sendOrderCreated`. Сервис создаёт команду
`SendOrderConfirmation` с UUID `messageId`, ID сохранённого заказа `orderId`,
`customerEmail` и `createdAt` (время создания команды в ISO 8601).
Контракт общий для producer и worker и не зависит от модели Prisma.

`RabbitMqPublisher` использует `amqplib`: объявляет durable-очередь
`email.notifications`, публикует persistent-сообщение через default exchange
(имя `""`, тип `direct`, routing key совпадает с именем очереди) и ждёт
publisher confirm. AMQP-свойства включают `messageId`, `contentType: application/json`
и `type: SendOrderConfirmation`; тело — JSON команды. `mandatory: true`
позволяет обнаружить отсутствие маршрута в очередь.
В логах успешной публикации есть `Notification publication confirmed`,
`messageId` и `orderId`.

Publisher confirm подтверждает публикацию брокером, а consumer ACK — обработку
сообщения потребителем. Это независимые механизмы; confirm не означает отправку
письма. Durable-очередь и persistent-сообщение помогают пережить перезапуск
брокера, но не дают абсолютной гарантии доставки.
Подробнее: [amqplib API](https://amqp-node.github.io/amqplib/channel_api.html),
[RabbitMQ confirms и ACK](https://www.rabbitmq.com/docs/confirms).

HTTP-ответ больше не ждёт трёхсекундную имитацию email, но ждёт публикацию.
Таймаут подключения и ожидания confirm — по 5 секунд; это не общий таймаут
всего HTTP-запроса. При ошибке или отсутствии подтверждения сервис пишет
`Notification publication failed or unconfirmed` с `messageId` и `orderId`.
API возвращает `201` с прежним телом: заказ уже сохранён, остатки списаны.
Письмо при этом может быть потеряно; при таймауте результат публикации может
быть неизвестен. Автоматического повтора публикации нет.
Коммит БД и публикация не атомарны: падение между ними также может потерять
уведомление. Это ограничение оставлено до этапа Transactional Outbox.

Транзакция БД заканчивается до уведомления: во время ожидания заказ уже доступен
через `GET`, а блокировки остатков сняты. Event loop продолжает обрабатывать запросы.
Ошибочные запросы не вызывают уведомление.

### Ручная проверка без worker

1. Запустите `docker compose up -d --wait`, примените миграции и seed по инструкции выше.
2. Запустите API: `npm run start:dev`. Оставьте worker выключенным.
3. Создайте 2–3 заказа с товарами, у которых хватает остатков.
   Для замера добавьте к приведённому выше `curl` параметр
   `-w '\nHTTP %{http_code}; total %{time_total}s\n'`.
4. Откройте Queues → `email.notifications` в Management UI.
   Проверьте `durable: true`, увеличение Ready и отсутствие Unacked.
5. Сопоставьте `messageId` и `orderId` в логах. Через Get messages с режимом
   возврата в очередь (requeue true) можно посмотреть JSON, `message_id`,
   `type` и `delivery_mode: 2` (persistent). Просмотр может пометить сообщение
   как повторно доставленное.
6. Для проверки отказа остановите только RabbitMQ: `docker compose stop rabbitmq`.
   Создайте ещё один заказ: ожидается `201`, заказ доступен через GET,
   а в логах — ошибка публикации. Поднимите брокер:
   `docker compose up -d --wait rabbitmq`. Новый заказ должен снова публиковаться;
   пропущенные уведомления автоматически не восстанавливаются.

Исторические замеры синхронного поведения этапа 1 сохранены
в [docs/observations.md](docs/observations.md).

## Отдельный email worker — шаг 4

Worker запускается в отдельном процессе как NestJS application context,
без HTTP-сервера, модулей заказов и Prisma. Для работы нужны RabbitMQ и
`RABBITMQ_URL` из `.env`; PostgreSQL и запущенный API для разбора очереди не нужны.
Подход описан в [NestJS standalone applications](https://docs.nestjs.com/standalone-applications).

```bash
docker compose up -d --wait rabbitmq
npm run build

# В отдельном терминале из корня проекта
npm run start:worker
```

Команда запускает `dist/workers/email/main.js`. После изменения исходников
worker выполните сборку и перезапустите процесс. Для запуска API используйте
другой терминал: `npm run start:dev` или `npm run start:prod` после сборки.

Worker объявляет ту же durable-очередь `email.notifications`, задаёт
`prefetch(1)` и подписывается с `noAck: false`. У одного worker одновременно
не больше одной неподтверждённой задачи. Он проверяет обязательные поля JSON,
логирует `Mock email started` с `messageId`, `orderId` и `redelivered`, ждёт
около 3 секунд, логирует `Mock email completed` и только затем отправляет ACK.
После ACK появляется строка `Email task ACK` с теми же идентификаторами.
Настоящее письмо не отправляется; эта операция не обращается к БД.

При некорректной задаче или ошибке обработки worker завершает процесс с кодом 1,
закрывая соединение без ACK неуспешной задачи. Сообщение остаётся для повторной
доставки. Перед ручным перезапуском проверьте сообщение и причину ошибки;
автоматических retry, мгновенного `nack/requeue` и DLQ здесь нет.
При потере соединения или отмене consumer процесс также завершается с ошибкой;
после восстановления брокера worker нужно запустить заново.

`Ctrl+C` / SIGTERM запускают штатную остановку: worker отменяет подписку,
дожидается текущей обработки и ACK, затем закрывает соединение. Поэтому для
будущего эксперимента с падением до ACK понадобится принудительное завершение,
а не штатная остановка. Проверка аварийного завершения относится к шагу 5.

### Проверка обработки накопленных задач

1. Оставьте worker выключенным и создайте 2–3 заказа по инструкции выше.
   В Management UI у очереди должен увеличиться Ready.
2. Запустите `npm run start:worker`. По логам найдите `messageId` из producer.
3. Во время трёхсекундной обработки сообщение находится в Unacked;
   остальные ждут в Ready. Total — сумма Ready и Unacked.
4. После `Email task ACK` сообщение удаляется из очереди. Дождитесь обработки
   всех задач: Ready, Unacked и Total должны стать нулевыми.
5. Нажмите `Ctrl+C` и проверьте завершение процесса. Если остановка пришлась
   на задачу, worker сначала закончит её и отправит ACK.

Management UI обновляет счётчики с задержкой: отдельная трёхсекундная задача
может обработаться между обновлениями. Используйте несколько задач и сверяйте логи.

## Чтение заказа

```bash
curl -i http://localhost:3000/orders/1
```

`GET /orders/:id` возвращает `200 OK` и заказ в том же формате, что и `POST`.
Цена каждой позиции берётся из сохранённого `OrderItem.unitPrice`, поэтому
изменение каталога не влияет на историю. Чтение не меняет остатки.
Несуществующий заказ возвращает `404`. ID должен содержать десятичные цифры
и представлять целое число от 1 до `2147483647`; иначе возвращается `400`.
Дроби, отрицательные числа, экспоненциальная запись и пробелы не принимаются.

## Run tests

E2E-тесты используют реальный PostgreSQL: сначала запустите
`docker compose up -d --wait`. `DATABASE_URL` используется для подключения
к серверу и создания отдельной БД `order_flow_test_<uuid>`. Пользователю нужна
привилегия `CREATEDB` (пользователь стандартного контейнера PostgreSQL её имеет).
Setup применяет миграции, тесты загружают свои товары; после прогона тестовая БД
удаляется. Данные локальной БД проекта сохраняются. Unit-тест контроллера не требует БД.

Проверяются создание заказа, валидация и HTTP-коды, цены из БД, историческая цена,
откат частичного списания, rollback при реальной ошибке вставки позиции в PostgreSQL,
конкурентные заказы на последнюю единицу и запросы с разным порядком товаров.
Также проверяются чтение заказа после изменения цены товара, отсутствие побочных
изменений остатков при чтении, `404` и некорректные ID (`400`).
В e2e API подменён только `RabbitMqPublisher`: реальный брокер не требуется.
Управляемое ожидание публикации проверяет коммит, чтение заказа и
`FOR UPDATE NOWAIT` из другой транзакции до завершения HTTP-запроса.
Проверяются контракт команды и сохранение заказа с ответом `201` при ошибке
публикации; для ошибочных запросов публикация отсутствует.
Unit-тесты producer проверяют ожидание confirm, broker nack, возврат
недоставляемого сообщения, таймаут и повторное подключение следующим запросом.
Unit-тесты worker проверяют ACK после обработки, остановку на некорректной
задаче, завершение текущей задачи при shutdown и реакцию на потерю соединения.
Реальные публикация и обработка проверяются отдельно по ручным инструкциям выше.

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. To connect it, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It writes the app key and secret into `.env` and makes every `nest start` script (`start`, `start:dev`, `start:debug`) load it. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand: create an application and an API key at [observe.nestjs.com](https://observe.nestjs.com), and set the pair as `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment the app runs in.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
