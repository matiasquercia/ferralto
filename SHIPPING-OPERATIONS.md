# Envíos Ferralto

El carrito consulta el costo de envío en el servidor al completar el domicilio. Georef verifica calle, altura y localidad, y el servidor valida el código postal y la cobertura de AMBA. Los destinos de La Plata, los que exceden el alcance operativo del piloto y los que no tienen una dirección precisa pasan a consulta por WhatsApp. El usuario ve el importe del pedido después de ingresar la dirección.

El servidor calcula el cociente de carga del pedido usando las cantidades, el peso y el volumen acumulados y el mayor largo. Usa los perfiles comerciales del piloto cuando no hay medidas de transporte completas. Calcula distancia geodésica WGS84 desde la fábrica de Caseros, con franjas de 5 km hasta 55 km. Aplica el beneficio del piloto a los 17 barrios seleccionados según su geometría oficial. Los parámetros y perfiles viven en `src/data/shipping/safari.json`. Los datos de barrios y perímetro de Buenos Aires Data se usan bajo CC BY 2.5 AR. Se conservaron las geometrías completas de los barrios elegibles. La atribución y las fuentes están en `src/data/shipping/caba-geography-source.json`.

## Configuración y prueba

- `npm run dev` usa el punto aproximado de Juan de Garay 4970, Caseros, cuando falta `SHIPPING_ORIGIN_JSON`. Para pruebas de pago usá credenciales de prueba de Mercado Pago.
- El despliegue de GitHub Actions configura el punto de Juan de Garay 4970, Caseros, probado en la demo y confirmado para producción el 10/11/2026. Si cambia el despacho, actualizá `SHIPPING_ORIGIN_JSON` en GitHub Secrets. El formato es un objeto con `point` (`lat` y `lon` numéricas WGS84) y `confirmation` (texto no vacío con fecha y fuente del punto confirmado). En un despliegue manual sin ese valor válido, el Worker deriva la cotización a WhatsApp.
- Para validar una compilación con `npm run preview`, usá el mismo formato con coordenadas de prueba en el entorno local. El punto aproximado del modo desarrollo no habilita cobros en la compilación.
- `npm test`, `npm run check` y `npm run build` verifican la rama. En el navegador, probá un carrito con varias cantidades, un cambio de dirección, un destino sin cobertura y el subtotal antes de ingresar la dirección.
- Al crear una preferencia de Mercado Pago, el servidor valida de nuevo el domicilio y las líneas y recalcula el importe. Si difiere del mostrado, pide recotizar. Para pedidos que requieren cotización se conserva la opción explícita de pagar solo productos y coordinar el envío por WhatsApp.

Fuentes: [Georef](https://www.argentina.gob.ar/georef), [AMBA](https://www.argentina.gob.ar/dami/centro/amba), [Barrios de Buenos Aires](https://data.buenosaires.gob.ar/dataset/barrios), [Perímetro](https://data.buenosaires.gob.ar/es_AR/dataset/perimetro).
