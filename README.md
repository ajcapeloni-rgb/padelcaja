# PádelCaja — Factory Padel Córdoba

App de ingresos y egresos para el complejo, con el mismo esquema que PádelTurnos:
una Google Sheet como base de datos + un Apps Script como backend + una página
HTML como frontend. Gratis, sin servidores, accesible desde cualquier lado y
protegida con un PIN propio (ver paso 3).

## 1) Crear la Google Sheet

1. Andá a [sheets.google.com](https://sheets.google.com) y creá una planilla nueva (vacía).
2. Ponele un nombre, por ejemplo "PádelCaja - Datos".
3. Copiá el ID de la planilla: es la parte de la URL entre `/d/` y `/edit`.
   Ej: `https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`

No hace falta crear las hojas (`movimientos`, `categorias`, `cierres`) a mano:
el script las crea solas la primera vez que se usa, y precarga categorías
típicas de un complejo de pádel.

## 2) Crear el Apps Script

1. Desde la misma planilla: **Extensiones > Apps Script**.
2. Borrá el contenido de `Code.gs` que aparece por defecto y pegá el contenido
   del archivo [`Code.gs`](Code.gs) de esta carpeta.
3. Reemplazá la línea:
   ```js
   const SHEET_ID = 'PEGA_ACA_EL_ID_DE_TU_GOOGLE_SHEET';
   ```
   por el ID que copiaste en el paso 1.
4. Guardá (ícono de disquete o Ctrl+S).

## 3) Publicar como Web App

1. Arriba a la derecha: **Implementar > Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Configuración:
   - **Ejecutar como**: Yo (tu cuenta)
   - **Quién tiene acceso**: **Cualquier usuario** (Anyone)

     Ojo: esto **no** significa que cualquiera pueda entrar a tus datos. Es
     necesario porque en modo "Solo yo" Google bloquea las llamadas
     automáticas (fetch) del navegador aunque estés logueado — solo
     funcionaría pegando la URL a mano en la barra de direcciones, no desde
     una app. Para compensarlo, la propia app pide un **PIN** que se valida
     en el servidor (ver más abajo) antes de leer o escribir cualquier dato.
4. Hacé clic en **Implementar** y autorizá los permisos que pida Google
   (es tu propio script, es normal que pida acceso a tu planilla).
5. Copiá la **URL de la aplicación web** que te da (termina en `/exec`).

### Configurar el PIN

1. En el editor de Apps Script: **Configuración del proyecto** (ícono de
   engranaje) > **Propiedades del script** > **Añadir propiedad del script**.
2. Propiedad: `APP_PIN` — Valor: el PIN que quieras usar (ej: `4 dígitos`, o
   algo más largo si preferís).
3. Guardá. La próxima vez que abras la app te va a pedir ese PIN una sola vez
   y lo va a recordar en ese dispositivo.

Si en algún momento querés cambiar el PIN, alcanza con editar el valor de esa
propiedad — no hace falta volver a implementar el script.

## 4) Conectar el frontend

1. Abrí [`index.html`](index.html) de esta carpeta.
2. Buscá esta línea (cerca del `<script>`, al principio):
   ```js
   const API = 'PEGA_ACA_LA_URL_DEL_DEPLOY';
   ```
3. Reemplazá `'PEGA_ACA_LA_URL_DEL_DEPLOY'` por la URL que copiaste en el paso
   anterior.

## 5) (Opcional) Activar la lectura automática de comprobantes

El botón **📷 Comprobante** usa la API de Gemini (Google) para leer la foto de
un comprobante de pago y completar solo el monto, la fecha y el proveedor del
egreso. Es opcional — sin esto, la app funciona igual cargando todo a mano.

1. Andá a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) y
   generá una API key gratuita (con tu misma cuenta de Google).
2. En el editor de Apps Script: **Configuración del proyecto** (ícono de
   engranaje, en el menú lateral) > bajá hasta **Propiedades del script** >
   **Añadir propiedad del script**.
3. Propiedad: `GEMINI_API_KEY` — Valor: la key que generaste.
4. Guardá. No hace falta volver a implementar el script para que tome el
   cambio de propiedad.

La API key nunca queda expuesta en el HTML: vive solo en el servidor
(Apps Script), y el frontend solo le manda la foto.

## 6) Publicar la página para acceder desde el celu

Igual que hiciste con PádelTurnos: subir esta carpeta a un repo de GitHub y
activar GitHub Pages (Settings > Pages > branch `main`, carpeta `/`). Vas a
tener una URL fija tipo `https://tu-usuario.github.io/padelcaja/` para
abrir la app desde cualquier dispositivo.

## Notas

- Las categorías se pueden crear, editar y borrar desde la pestaña
  **Categorías** — las que vienen precargadas son solo un punto de partida.
- El "Cierre de Caja" compara los movimientos con medio de pago **Efectivo**
  del día contra lo que contás físicamente en la caja.
- "Reportes" permite exportar los movimientos del mes a CSV (se puede abrir
  con Excel/Google Sheets).
