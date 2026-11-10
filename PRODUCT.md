# wick notes



**Self-hosted collaborative Markdown knowledge base**



*Your notes. Your server. Your knowledge.*



## 1. Visión del producto



**wick notes** es una plataforma de notas y conocimiento colaborativo, de código abierto y autoalojada (*self-hosted*), diseñada para personas y equipos que necesitan centralizar su información, acceder a ella desde distintos dispositivos y colaborar en tiempo real sin depender de plataformas de almacenamiento externas.



El producto nace de un problema cotidiano: la fragmentación del conocimiento entre computadoras, servidores, sistemas operativos y herramientas de trabajo.



Un desarrollador puede tener documentación importante almacenada en su Mac, notas técnicas en un servidor Linux y apuntes de proyectos en una computadora Windows. Con el tiempo, recordar dónde se encuentra determinada información se convierte en un problema.



wick notes busca eliminar esa fragmentación ofreciendo un espacio centralizado de conocimiento que el usuario controla completamente.



No importa desde qué sistema operativo esté trabajando: su documentación estará disponible desde el navegador, la terminal o sus agentes de inteligencia artificial, siempre que tenga acceso al servidor donde está instalada la aplicación.



**La filosofía es sencilla: el conocimiento debe estar disponible donde el usuario lo necesita, no donde accidentalmente lo guardó.**



---



## 2. Problema que resolvemos



Actualmente, muchos profesionales trabajan desde múltiples dispositivos y entornos.



Esto provoca situaciones como:



- No recordar en qué computadora se guardó una nota.

- Tener documentación duplicada o desactualizada.

- Depender de servicios externos para sincronizar información.

- No poder consultar fácilmente documentos desde una terminal.

- Mantener documentación técnica separada de las herramientas de desarrollo.

- No contar con un espacio privado donde varias personas puedan editar información simultáneamente.

- No poder conectar agentes de inteligencia artificial a una base de conocimiento propia.



Las aplicaciones tradicionales de notas resuelven algunas de estas necesidades, pero frecuentemente requieren servicios de sincronización externos, suscripciones o integraciones adicionales para habilitar colaboración y automatización.



wick notes busca ofrecer estas capacidades desde una instalación privada y controlada por el propio usuario.



---



## 3. Nuestra solución



wick notes permite instalar un servidor de conocimiento dentro de una red local, un homelab, una infraestructura empresarial o un servidor privado.



Cada instalación funciona de manera independiente.



El servidor centraliza los documentos, usuarios, permisos y servicios de colaboración.



Los usuarios pueden acceder mediante tres interfaces principales:



### Aplicación web



Una interfaz moderna y minimalista donde los usuarios pueden crear, organizar, buscar y editar documentos Markdown de manera visual.



El editor permite colaboración en tiempo real, mostrando los cambios y la presencia de otros usuarios conectados.



### CLI



Una interfaz de línea de comandos que permite acceder a las notas desde macOS, Linux y Windows.



Los usuarios pueden consultar, buscar, crear, editar y exportar documentos sin necesidad de abrir un navegador.



La CLI debe ser especialmente útil para desarrolladores, administradores de sistemas y personas que trabajan frecuentemente desde terminales o sesiones SSH.



### MCP para agentes de IA



Un servidor compatible con Model Context Protocol que permite a agentes de inteligencia artificial interactuar con la documentación mediante herramientas autorizadas.



Por ejemplo, un usuario podría solicitar a Claude Code:



"Documenta la solución que acabamos de implementar y guárdala en mis notas de infraestructura."



El agente podrá crear el documento correspondiente dentro de wick notes, respetando los permisos del usuario.



La inteligencia artificial será una integración opcional. wick notes debe funcionar completamente sin conectarse a proveedores de IA.



---



## 4. Público objetivo



wick notes está dirigido principalmente a:



**Desarrolladores independientes**



Profesionales que trabajan en varios proyectos y dispositivos y necesitan centralizar notas técnicas, documentación, ideas y procedimientos.



**Equipos de desarrollo**



Pequeños equipos que necesitan compartir arquitectura, decisiones técnicas, documentación de APIs, pendientes y procedimientos.



**Administradores de sistemas y homelabs**



Usuarios que desean mantener documentación de servidores, redes, servicios, configuraciones y procedimientos de mantenimiento dentro de su propia infraestructura.



**Pequeñas empresas y organizaciones**



Equipos que necesitan una plataforma privada para documentar procesos, crear manuales y compartir información sin depender obligatoriamente de servicios externos.



**Usuarios de agentes de IA**



Personas que utilizan herramientas como Claude Code y desean proporcionarles acceso controlado a una base de conocimiento persistente.



---



## 5. Principios fundamentales



### 5.1. Self-hosted first



La aplicación debe poder instalarse en infraestructura controlada por el usuario.



No debe requerir una cuenta central de wick notes, licencias verificadas en línea, servicios externos de autenticación ni proveedores de almacenamiento obligatorios.



Una instalación debe poder funcionar en una red local sin acceso a internet, siempre que el servidor y los clientes puedan comunicarse dentro de esa red.



### 5.2. Privacy by design



Cada instancia administra su propia información.



Los documentos no deben enviarse automáticamente a servicios externos.



Los administradores controlan usuarios, permisos, almacenamiento, acceso de red y respaldos.



Las integraciones externas, incluidos los proveedores de IA, deben ser opcionales y estar claramente identificadas.



### 5.3. Markdown first



Markdown es el formato principal de intercambio y portabilidad del contenido.



Los usuarios deben poder importar y exportar documentos `.md` sin quedar encerrados en un formato propietario.



La aplicación puede utilizar representaciones internas más avanzadas para colaboración, pero debe mantener mecanismos confiables de conversión a Markdown.



### 5.4. Collaboration first



La edición simultánea no es una funcionalidad secundaria.



Es uno de los pilares de wick notes.



Varios usuarios deben poder modificar un documento en tiempo real sin utilizar mecanismos que sobrescriban indiscriminadamente los cambios de otros participantes.



El sistema debe manejar la concurrencia, desconexiones, reconexiones y persistencia de manera confiable.



### 5.5. API-first



La aplicación web no debe ser la única manera de interactuar con los documentos.



La API constituye el contrato central de acceso a la plataforma.



Web, CLI, MCP y futuras integraciones deben reutilizar las mismas reglas de negocio, autenticación y autorización.



### 5.6. AI-ready, not AI-dependent



wick notes debe facilitar la interacción con agentes de inteligencia artificial sin obligar al usuario a consumir servicios de IA.



El MCP proporcionará herramientas para buscar, leer, crear y modificar notas mediante permisos explícitos.



Los agentes deben tener acceso únicamente a los documentos y operaciones autorizados.



### 5.7. Simplicidad operativa



El proyecto debe ser fácil de instalar, actualizar, respaldar y mantener.



El método principal de despliegue será Docker Compose.



No debemos introducir infraestructura distribuida, dependencias externas obligatorias o complejidad innecesaria para un sistema destinado inicialmente a equipos pequeños.



---



## 6. Funcionalidades principales



### Documentación



- Crear, editar, renombrar y eliminar documentos.

- Editor Markdown con vista previa en vivo: los símbolos se ocultan y reaparecen, editables, donde está el cursor.

- Encabezados, tablas, listas, citas, enlaces y bloques de código.

- Organización por carpetas y espacios de trabajo.

- Búsqueda de documentos.

- Importación y exportación Markdown.

- Historial y recuperación de versiones.



### Colaboración



- Edición simultánea.

- Sincronización mediante WebSockets.

- Cursores y presencia de colaboradores.

- Guardado automático.

- Manejo de desconexiones y reconexiones.

- Resolución de modificaciones concurrentes mediante CRDT.



### Administración



- Usuarios locales.

- Espacios de trabajo.

- Roles y permisos.

- Acceso restringido a documentos.

- Configuración privada de cada instalación.

- Herramientas de respaldo y restauración.



### CLI



La CLI debe permitir operaciones como:



```bash

wick notes list

wick notes search "postgresql"

wick notes get <document-id>

wick notes create "Nueva nota"

wick notes edit <document-id>

wick notes export <document-id>

```



Estas operaciones representan el contrato deseado y deberán implementarse durante el desarrollo.



### MCP



El MCP deberá ofrecer herramientas como:



```text

notes_list

notes_search

notes_read

notes_create

notes_append

notes_update

notes_history

```



Las escrituras deben utilizar la capa central de operaciones y mecanismos seguros de concurrencia.



---



## 7. Arquitectura tecnológica



La arquitectura inicial estará basada en:



| Componente | Tecnología |

|---|---|

| Aplicación web | Nuxt 4 |

| Frontend | Vue 3 + TypeScript |

| Componentes UI | Nuxt UI + Tailwind CSS |

| Editor | CodeMirror 6 (Markdown con vista previa en vivo) |

| Colaboración | Yjs |

| Servidor WebSocket | Hocuspocus |

| API | Nitro |

| Base de datos | PostgreSQL |

| ORM | Prisma |

| CLI | Node.js + TypeScript |

| Integración IA | MCP Server |

| Paquetes | pnpm |

| Despliegue | Docker Compose |



El proyecto se organizará como un monorepositorio para reutilizar módulos, esquemas de validación, contratos y lógica de negocio.



El estado colaborativo Yjs será la fuente principal de verdad durante la edición. Contiene el propio texto Markdown de cada documento, sin conversiones: lo que se escribe es exactamente lo que se guarda, se exporta y leen la CLI y los agentes.



Las modificaciones realizadas desde CLI y MCP deberán integrarse con el mismo sistema de concurrencia utilizado por la aplicación web.



---



## 8. Experiencia de usuario



wick notes debe sentirse rápido, sencillo y enfocado en escribir.



La interfaz debe priorizar:



- Navegación clara entre documentos.

- Editor visual sin distracciones.

- Acceso rápido a notas recientes.

- Búsqueda eficiente.

- Indicadores claros de sincronización.

- Presencia de colaboradores.

- Diseño adaptable a pantallas de diferentes tamaños.



El usuario no debería necesitar conocimientos técnicos para crear y administrar notas desde la interfaz web.



Los usuarios avanzados dispondrán de la CLI, API y MCP sin que esas capacidades compliquen la experiencia de los usuarios convencionales.



---



## 9. Distribución y despliegue



wick notes es un producto distribuible, no un servicio centralizado administrado por su creador.



Cada persona u organización podrá instalar su propia instancia.



Ejemplos de entornos:



- Servidores Ubuntu.

- Homelabs.

- Servidores privados.

- Computadoras locales con Docker.

- Redes de oficina.

- Infraestructuras privadas accesibles mediante VPN.



El proceso de instalación objetivo será:



```bash

git clone <repository-url>

cd wick-notes

cp .env.example .env

docker compose up -d

```



La instalación deberá incluir un procedimiento de configuración inicial del administrador, almacenamiento persistente y documentación clara.



Las actualizaciones no deben eliminar ni sobrescribir los datos de los usuarios.



La plataforma debe poder ejecutarse sin exponer públicamente sus servicios a internet.



---



## 10. Qué no queremos construir



wick notes no pretende convertirse inicialmente en:



- Un clon de todas las funcionalidades de otras aplicaciones de notas.

- Una plataforma SaaS obligatoria.

- Un sistema de administración de proyectos.

- Una aplicación de chat.

- Un proveedor de modelos de inteligencia artificial.

- Un servicio de almacenamiento general de archivos.

- Un sistema de sincronización automática de todos los archivos de las computadoras.



Nuestro enfoque es resolver muy bien un problema específico: crear, centralizar, consultar y compartir conocimiento escrito en Markdown.



Las funcionalidades futuras deberán contribuir a ese objetivo.



---



## 11. Filosofía de desarrollo



No debemos desarrollar funcionalidades únicamente porque otras aplicaciones las ofrecen.



Cada decisión debe responder a una necesidad real del producto.



Las prioridades son:



1. Confiabilidad del almacenamiento.

2. Consistencia de la colaboración.

3. Portabilidad de los documentos.

4. Seguridad y privacidad.

5. Simplicidad de instalación.

6. Experiencia de escritura.

7. Integración con herramientas externas.



Antes de agregar funcionalidades avanzadas debemos garantizar que un documento pueda crearse, editarse simultáneamente, guardarse, recuperarse, consultarse por CLI y utilizarse mediante MCP sin pérdida de información.



---



## 12. Visión a largo plazo



Queremos que wick notes se convierta en una pequeña infraestructura de conocimiento personal y colaborativo.



Una instalación que puede acompañar a una persona durante años, independientemente del sistema operativo, dispositivo o editor que utilice.



Una aplicación donde los equipos mantienen documentación actualizada y los agentes de inteligencia artificial pueden contribuir al conocimiento de forma controlada.



Un proyecto que cualquier persona pueda instalar, administrar y adaptar a su propia infraestructura.



El objetivo no es almacenar la mayor cantidad posible de notas.



**El objetivo es que el conocimiento esté disponible, sea útil y permanezca bajo el control de quien lo creó.**



---



## 13. Definición de éxito



Consideraremos que wick notes cumple su propósito cuando:



- Un usuario instala la plataforma en su propio servidor.

- Puede acceder desde macOS, Linux y Windows.

- Encuentra todas sus notas desde cualquier dispositivo conectado.

- Varias personas pueden editar el mismo documento simultáneamente.

- Puede consultar documentación desde una terminal SSH.

- Un agente de IA autorizado puede leer y crear notas mediante MCP.

- Los datos permanecen disponibles después de reinicios y actualizaciones.

- Puede exportar sus documentos Markdown.

- Puede realizar y restaurar respaldos.

- La instalación funciona dentro de una red privada sin depender obligatoriamente de servicios externos.



Esta es la visión que debe guiar las decisiones de arquitectura, interfaz, almacenamiento, colaboración, seguridad y desarrollo.



**wick notes — Your notes. Your server. Your knowledge.**
