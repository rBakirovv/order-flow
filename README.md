<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

Для локального запуска нужны Node.js 24 LTS, npm и работающий Docker Compose.
NestJS запускается на компьютере, PostgreSQL — в Docker.

```bash
npm ci
cp .env.example .env
```

Задайте собственный `POSTGRES_PASSWORD` и обновите пароль в `DATABASE_URL`.
Порт, имя базы и пользователь в URL должны совпадать с `POSTGRES_*`.
Специальные символы в имени пользователя и пароле нужно URL-кодировать.
Не перезаписывайте существующий `.env`: он может содержать ключи Observe.

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
Расчёт суммы и проверка непустого заказа будут реализованы в сервисе заказов.

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
Чтение заказа и синхронное уведомление с задержкой будут добавлены следующими шагами.

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
