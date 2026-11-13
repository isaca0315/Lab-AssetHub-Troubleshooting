# AssetHub

AssetHub es una aplicación de tres servicios orquestada con Docker Compose: una
interfaz web con API en Node.js, almacenamiento de objetos compatible con S3
(Garage) y PostgreSQL 15 para los metadatos.

El entorno arranca con tres fallas que aparecen en momentos distintos. Vas a
reproducirlas, encontrar la causa con las herramientas del entorno y dejarlas
corregidas. El enunciado completo, los criterios de aceptación y las preguntas
para la defensa están en [`GUIA_ESTUDIANTE.md`](GUIA_ESTUDIANTE.md).

## Requisitos

- Docker Engine con Compose v2 (`docker compose`)
- `curl`
- Un navegador (opcional: todo se puede reproducir con `curl`)
- ~1 GB libre para imágenes y archivos de prueba

## Puesta en marcha

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Espera a que los servicios figuren como `healthy` o `Up`. El primer arranque
puede tardar mientras se descargan las imágenes. La interfaz queda en
<http://localhost:3000>.

```bash
curl -s http://localhost:3000/health
```

## Servicios

| Servicio | Contenedor | Función | Acceso |
|---|---|---|---|
| `app` | `assethub-api` | interfaz web y API HTTP | <http://localhost:3000> |
| `garage` | `assethub-storage` | almacenamiento compatible con S3 | interno; API publicada en localhost |
| `postgres` | `assethub-db` | base de datos de metadatos | solo desde la red del stack |

Los puertos publicados escuchan solo en `127.0.0.1`.

## Endpoints

| Ruta | Método | Función |
|---|---|---|
| `/` | GET | interfaz web |
| `/health` | GET | estado de la base y configuración del almacenamiento |
| `/files` | GET | últimos 50 registros de metadatos |
| `/upload` | POST | subida `multipart/form-data` con el campo `file` |

La interfaz llama a esos mismos endpoints, así que una falla del backend se ve
también en pantalla.

## Comandos útiles

```bash
docker compose ps
docker compose logs app --tail 30
docker compose exec app sh -c 'df -h /data/uploads'
docker compose exec postgres psql -U app -d assethub -c '\dt'
docker compose exec garage /garage status
```

## Estructura

```
.
├── docker-compose.yml      # servicios, red, healthchecks, logs y tmpfs
├── .env                    # variables de la aplicación
├── garage.toml             # configuración de Garage
├── GUIA_ESTUDIANTE.md      # enunciado del laboratorio
├── docs/img/               # capturas de la interfaz
└── app/                    # código de la aplicación (Node.js + Express)
    ├── Dockerfile
    ├── package.json
    ├── public/             # interfaz web
    └── server.js
```

## Limpieza

```bash
docker compose down -v
```

`-v` borra la base, los datos del almacenamiento y la red del laboratorio. Los
archivos del repositorio no se modifican.

## Aviso

Las credenciales y secretos de este laboratorio son ficticios y están fijados a
propósito para que el entorno sea reproducible. No los reutilices fuera de la
práctica ni expongas estos puertos a Internet.
