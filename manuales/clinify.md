# Manual de soporte — Clinify (historiaclinify.com)

Fuente: código de la aplicación (repositorio `historiaclinify`, versión del 22 de noviembre de 2026). Todo lo que está aquí es lo que un cliente puede saber.

## 1. Qué es

Clinify es un software en la nube para clínicas y consultorios odontológicos: historia clínica digital, odontograma, plan de tratamiento, agenda, consentimientos con firma, fórmulas y documentos, cajas, inventario, reportes, RIPS, facturación electrónica y nómina electrónica. Está en español y no se instala nada: funciona en el navegador (Chrome, Edge, Safari o Firefox) en computador, tablet o celular.

## 2. Registro y prueba gratis

- En historiaclinify.com, botón "Crear mi clínica gratis".
- Pide: nombre de la clínica, nombre completo, correo y contraseña (mínimo 6 caracteres). Hay que aceptar la Política de Tratamiento de Datos y los Términos y Condiciones.
- La prueba dura 14 días y no pide tarjeta.
- Tres días antes de terminar la prueba aparece un aviso amarillo arriba con el botón "Pagar suscripción".
- Si la prueba termina sin pagar, la cuenta queda en modo solo lectura: se puede consultar toda la información, pero no crear ni guardar cambios hasta activar la suscripción. Los datos no se borran por eso.
- En la pantalla de ingreso hay un botón "Entrar con cuenta demo" para ver la plataforma con datos de ejemplo.

## 3. Planes y precios

- Plan base: $120.000 COP al mes. Incluye hasta 2 usuarios clínicos (odontólogos o profesionales que atienden pacientes).
- Cada usuario clínico adicional: $30.000 COP al mes.
- Usuarios administrativos y auxiliares: ilimitados, sin costo.
- Pacientes: ilimitados.
- Pago semestral: 15% de descuento. Pago anual: 25% de descuento.
- Fuera de Colombia la web muestra el equivalente en la moneda local.
- En la web hay una calculadora: se indica cuántos usuarios clínicos tiene la clínica y muestra el total.
- Ejemplos mensuales: 1 o 2 clínicos $120.000; 3 clínicos $150.000; 4 clínicos $180.000.

## 4. Cómo se paga y se renueva

- El pago se hace dentro de la plataforma, no en la web pública: desde el aviso "Pagar suscripción" o en Configuración, sección de suscripción ("Estado de tu plan, periodo de prueba y pagos").
- Se elige el plan (mensual, semestral o anual) y cuántos usuarios clínicos incluir. No deja elegir menos de los profesionales activos que ya tiene la clínica.
- Pasarela: Wompi (Bancolombia). Acepta tarjetas, PSE y Nequi.
- Resultados posibles: "Pago aprobado" (se activa en unos segundos), "pago en proceso de confirmación" (hay que esperar; no volver a pagar) o "no se pudo procesar" (intentar de nuevo o con otro medio).
- Renovación automática: si se guarda una tarjeta, la suscripción se cobra sola al vencer. Se puede activar o desactivar en Configuración. Sin tarjeta guardada hay que renovar a mano antes del vencimiento.
- Siete días antes de vencer la suscripción aparece el aviso con el botón "Renovar suscripción".
- Si la suscripción vence, la cuenta queda en modo solo lectura hasta renovar.
- Cada pago genera una "Factura de suscripción" que se puede ver e imprimir desde la misma sección.

## 5. Cancelación

- No hay contratos ni permanencia.
- Según la web, al cancelar los datos se conservan 90 días más, y en ese tiempo se pueden exportar en JSON o CSV.

## 6. Ingreso y contraseña

- "Ya tengo cuenta" → correo y contraseña.
- Olvidé la contraseña: se pide el enlace con el correo; llega un enlace válido por 60 minutos. Revisar también la carpeta de spam.
- Si el correo está vinculado a varias clínicas, al entrar pregunta a cuál ingresar.
- Cambiar la contraseña propia: Configuración → contraseña (pide la actual y la nueva dos veces).
- "Tu sesión expiró": volver a iniciar sesión.

## 7. Primeros pasos recomendados

La plataforma muestra una guía "Primeros pasos en Clinify" (se puede volver a abrir en Configuración → Guía de inicio):

1. Personalizar la clínica: nombre, logo y colores.
2. Agregar los profesionales.
3. Revisar los aranceles (precios de los tratamientos).
4. Crear el primer paciente.
5. Agendar la primera cita.

## 8. Usuarios, roles y permisos

Hay cuatro roles, con estos accesos por defecto:

| Rol | Menú | Pestañas de la ficha |
|---|---|---|
| Administrador | Todo | Todas |
| Clínico | Agenda, Pacientes, Aranceles, Inventario, Reportes, Soporte | Todas |
| Auxiliar | Agenda, Pacientes, Inventario, Soporte | Datos, Anamnesis, Odontograma, Abonos, Imágenes, Consentimientos |
| Recepción | Agenda, Pacientes, Cajas, Soporte | Datos, Abonos, Comprobantes, Consentimientos |

- Quien tiene acceso a Pacientes también ve Seguimiento, Radiografías y Laboratorio.
- El administrador puede cambiar qué ve cada rol en Configuración → permisos, y restaurar los valores por defecto.
- Crear un usuario: Configuración → usuarios. Se pone nombre, correo, contraseña y rol. La plataforma muestra las credenciales para que el administrador se las pase al usuario; cada persona entra con su propio correo y contraseña en la misma dirección.
- El administrador puede restablecer la contraseña de un usuario y desactivarlo.
- Profesionales: Configuración → profesionales. Se registra nombre, especialidad, registro médico y firma (dibujada o subida), que se usa sola al firmar documentos, fórmulas y consentimientos. Los profesionales activos son los que cuentan como "usuarios clínicos" del plan.

## 9. Secciones del menú

Agenda, Pacientes, Seguimiento, Cajas, Aranceles, Inventario, Radiografías, Laboratorio, Reportes, Soporte y Configuración. En celular el menú se abre con el botón de la barra superior.

## 10. Pacientes y ficha clínica

- Pacientes → nuevo paciente. Si la persona ya tiene cita, conviene crearla desde la Agenda para que la historia quede enlazada a la cita.
- Se busca por nombre o documento.
- La ficha tiene estas pestañas: Datos Personales, Anamnesis, Examen Clínico, Odontograma, Periodontograma, Plan de Tratamiento, Abonos, Comprobantes, Historia Clínica (evoluciones), Radiografías y Fotos, Consentimientos y Documentos.
- Eliminar un paciente borra también su historia, planes, fotos y registros. No se puede deshacer.

## 11. Odontograma y plan de tratamiento

- Odontograma con numeración FDI, dentición adulta y temporal, 5 zonas por diente y 13 condiciones.
- Periodontograma aparte.
- Plan de tratamiento por sesiones, con avance y notas. Un paciente puede tener varios planes.
- Los precios salen de Aranceles; ahí se ajusta la lista de tratamientos y valores de la clínica.

## 12. Evoluciones (Historia Clínica)

- Cada evolución queda con fecha, hora y profesional.
- Hay plantillas de evolución para no escribir desde cero.
- Los registros que vienen del plan de tratamiento son de solo lectura dentro de la historia.

## 13. Abonos, comprobantes y cajas

- Los pagos del paciente se registran en la pestaña Abonos; cada uno genera un comprobante imprimible.
- Medios de pago por defecto: efectivo, transferencia, tarjeta débito, tarjeta crédito, Nequi, Daviplata, cheque y otro. La clínica puede definir los suyos.
- Cajas reúne pagos, gastos e ingresos, cierre, honorarios de profesionales y cartera (pacientes con saldo pendiente, con botón para escribirles por WhatsApp).
- La moneda, los decimales y el formato de los comprobantes (prefijo, consecutivo, pie) se configuran en Configuración.

## 14. Consentimientos y firma

- Los consentimientos se firman en pantalla, por el paciente y el profesional.
- Firma a distancia: se crea un enlace personal para el paciente. Lo abre en su celular, lee el documento, confirma su número de documento y firma con el dedo. Queda guardado en su ficha, en "Firmados".
- Para la firma a distancia el paciente necesita tener registrados el número de documento y el celular en Datos Personales.
- Si al paciente le aparece "El enlace venció", la clínica debe enviarle uno nuevo.

## 15. Documentos y fórmulas

Desde la ficha se crean fórmulas médicas y otros documentos clínicos, con plantillas y la firma del profesional.

## 16. Agenda

- Vista semanal, varios profesionales y estados de cita.
- Desde el detalle de una cita se puede enviar al paciente la confirmación o recordatorio por correo (el paciente debe tener correo registrado).
- Integración con Klivox: las citas que se agendan en Klivox (incluidas las que agenda el asistente de WhatsApp) aparecen solas en la Agenda de Clinify y se actualizan cada 10 minutos. Clinify solo las muestra: se cambian o cancelan en Klivox.
- Para conectarla: en Klivox, Configuración → Integraciones privadas → Crear nueva integración, con permisos de solo lectura a Calendarios, Eventos de calendario y Contactos. La llave y el identificador de la subcuenta se pegan en Clinify, y luego se indica de qué profesional es cada calendario.

## 17. Seguimiento

"A quién hay que llamar hoy para que no se pierda ningún paciente". Tiene listas de presupuestos sin aceptar, pacientes por recuperar, implantes, ortodoncia y pacientes que abonaron, con acceso directo a WhatsApp.

## 18. Inventario, Laboratorio, Radiografías y Reportes

- Inventario: insumos, instrumental y equipos, con entradas, salidas y alertas de nivel bajo.
- Laboratorio: seguimiento de trabajos enviados al laboratorio.
- Radiografías y fotos: se suben por categoría a la ficha del paciente.
- Reportes: ingresos por día, por medio de pago y por periodo.

## 19. RIPS (Colombia)

- Se activa en Configuración solo si la clínica reporta RIPS al Ministerio de Salud. Al activarlo aparecen campos adicionales en aranceles (CUPS), profesionales, pacientes y evoluciones.
- Se configuran el NIT del obligado a reportar, el código de habilitación REPS (12 dígitos) y valores por defecto.
- El RIPS se genera por periodo a partir de las evoluciones y de los procedimientos terminados del plan. El archivo se sube al validador del Ministerio; si va con factura, junto con el XML de la factura electrónica.
- Si faltan datos, la pantalla indica cuáles y en qué pacientes.

## 20. Facturación electrónica (DIAN)

- Es opcional y solo la configura el administrador, en Configuración.
- Tiene ambiente de pruebas (habilitación) y de producción. En producción cada factura es real ante la DIAN.
- Se puede facturar a mano con el botón "Facturar" del abono, o automáticamente: al cierre del día (todas juntas, a la hora elegida) o de inmediato.
- Una factura emitida se anula con nota crédito.
- Puede enviar la factura por correo al paciente.

## 21. Importar y exportar

- Configuración → Exportar / Importar (solo administradores).
- Importar pacientes: se exportan en CSV desde el software anterior (Dentalink, Denty u otro) y se sube el archivo; los campos se reconocen solos.
- Copia de seguridad: descarga en JSON de pacientes, citas, consentimientos firmados, documentos, aranceles y configuración. Las imágenes no van dentro del archivo, quedan sus enlaces.
- También exporta planes de tratamiento en CSV.

## 22. Sin conexión a internet

Si se cae la conexión, el cambio queda guardado en ese equipo y se envía solo cuando vuelve. Mientras tanto no se debe cerrar la pestaña.

## 23. Soporte

- La atención de soporte es 24 horas.
- Dentro de la plataforma, sección Soporte: asistente virtual.
- WhatsApp de Klivox.
- Correo: admin@historiaclinify.com.

## 24. Problemas frecuentes

| Lo que dice el cliente | Qué responder |
|---|---|
| No me llega el correo para cambiar la contraseña | Revisar spam; el enlace dura 60 minutos; pedir uno nuevo. Si sigue sin llegar, pasar a una persona. |
| No puedo guardar nada | Probablemente terminó la prueba o venció la suscripción (modo solo lectura). Se activa con "Pagar suscripción". |
| Pagué y sigue bloqueado | Si salió "en proceso de confirmación", esperar; no pagar de nuevo. Si pasa mucho tiempo, pasar a una persona con el correo de la cuenta. |
| Un empleado no ve una sección | Depende de su rol. El administrador lo cambia en Configuración → permisos. |
| Quiero agregar otro odontólogo | Configuración → profesionales. Si pasan de 2 clínicos, cada adicional vale $30.000 COP al mes. |
| El paciente no puede firmar con el enlace | Verificar que tenga documento y celular registrados; si el enlace venció, enviar uno nuevo. |
| No veo el botón de facturar | La facturación electrónica está apagada o no es administrador. |
| Quiero traer mis pacientes de otro software | Configuración → Exportar / Importar, con un CSV. |
| Borré un paciente por error | No se puede deshacer desde la plataforma; pasar a una persona. |

## 25. Cuándo pasar a una persona

Cobros dobles o pagos que no se reflejan, pérdida de datos, errores que se repiten, reembolsos, facturación electrónica o RIPS rechazados, cambio de correo del administrador y cualquier cosa que no esté en este manual.
