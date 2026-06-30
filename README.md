# MAXER unified

App estatica preparada para Cloudflare Pages.

## Reglas Firestore recomendadas

Configurar manualmente en Firebase Console > Firestore Database > Reglas:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/data/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId}/journal/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Estas reglas permiten que cada usuario autenticado lea y escriba solo sus propios documentos bajo `users/{uid}/data` y `users/{uid}/journal`.

## Guardado y fallback

- `localStorage`: la app guarda siempre primero en `maxer_v1`.
- Firestore: si hay usuario autenticado, se sincroniza el estado principal en `users/{uid}/data/state`.
- Diario en Firestore: `journal.entries` se guarda aparte en `users/{uid}/journal/entries`.
- Fallback local: si Firestore falla o no hay conexion, la app conserva los cambios en `localStorage`.
- Modo invitado: usa solo `localStorage`.
- Los errores de localStorage o Firestore se registran con `console.warn` y no bloquean la app.

## Migracion del diario en Firestore

Si un usuario antiguo tiene `journal.entries` dentro de `users/{uid}/data/state`, la app:

1. Lee el documento principal.
2. Lee `users/{uid}/journal/entries`.
3. Combina entradas sin duplicar.
4. Escribe las entradas combinadas en `users/{uid}/journal/entries`.
5. Marca `state.migrations.journal_subcol`.
6. Reescribe `users/{uid}/data/state` sin `journal.entries`.

`localStorage` no cambia: sigue teniendo el estado completo para fallback local.

## Estados de sincronizacion

El indicador discreto del header puede mostrar:

- `Guardando...`: hay una escritura pendiente a Firestore.
- `Guardado`: Firestore confirmo la escritura.
- `Guardado local`: modo invitado o sin usuario autenticado.
- `Sin conexion - guardado local`: no hay conexion, los cambios quedan en este dispositivo.
- `Error nube`: Firestore rechazo o fallo al sincronizar; localStorage sigue siendo la copia local.
- `Error local`: fallo al escribir en localStorage.

El estado de sincronizacion es estado de UI y no se guarda en Firestore.

## Aviso de tamano

La app estima el tamano del `state` serializado. Si supera aproximadamente 750 KB, muestra un aviso discreto en consola y en Ajustes. El guardado no se bloquea.

## Privacidad y eliminacion

- El PIN es local del dispositivo. No se sincroniza con Firebase y no se guarda en texto plano.
- Ajustes incluye una seccion de privacidad con el resumen de almacenamiento local/nube.
- `Eliminar cuenta y datos` pide escribir `ELIMINAR`.
- En modo invitado o sin Firebase disponible, elimina solo las claves locales de MAXER/Diario y recarga la app.
- Con usuario Firebase, intenta borrar `users/{uid}/data/state`, `users/{uid}/journal/entries`, cerrar sesion y eliminar la cuenta Firebase si la sesion es reciente. Si Firebase exige reautenticacion, los datos se borran y se registra el aviso en consola.
- No se usa `localStorage.clear()`.

## Accesibilidad basica

- Los habitos se exponen como `role="checkbox"` con `aria-checked` y soporte Enter/Espacio.
- Los botones de series de rehab, flexiones e hipertrofia usan `aria-label` y `aria-pressed`.
- Los minimos diarios tienen `aria-label` por accion.
- Los modales principales tienen `role="dialog"` y `aria-modal="true"`.
- El PIN pad etiqueta cada numero y la tecla borrar.
- La barra de nivel usa `role="progressbar"`.

## Pendiente despues de Fase 4

- Verificar reglas en Firebase Console con la nueva ruta `journal`.
- En una fase posterior, excluir estado puramente visual de Firestore si se quiere evitar sincronizar pestañas o vistas entre dispositivos.
- Revisar si la eliminacion de cuenta debe mostrar un flujo de reautenticacion cuando Firebase devuelva `auth/requires-recent-login`.
