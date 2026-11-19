# Calculadora — Documento de desarrollo

**Versión 1.0.0 · Cierre de la Fase 1**

Fecha: 19 de noviembre de 2026 · Autor: Miguel · Web: <https://miguelcosme2343.github.io/Calculadora/>

---

## 1. Resumen

La **Calculadora** es una calculadora científica personal, instalable como aplicación web progresiva (PWA) en la tablet Android y pensada para usarse también en ventana flotante o pantalla dividida. Toma la comodidad del teclado y la presentación de resultados de Photomath, prescinde de lo que no se usa (cámara y resolución paso a paso) y añade lo que Photomath no tiene: **fasores y números complejos al estilo de circuitos de corriente alterna**, paralelo de impedancias, formatos de salida configurables, matrices y lectura de fórmulas desde capturas de pantalla.

El desarrollo comenzó el 17 de octubre de 2026. Tras unas semanas de uso real en la tablet, el resultado se da por satisfactorio y con este documento se **cierra la Fase 1** y se fija la **versión 1.0.0**.

| Dato | Valor |
|---|---|
| Versión | 1.0.0 |
| Inicio del desarrollo | 17/10/2026 |
| Cierre de la Fase 1 | 19/11/2026 |
| Plataforma | PWA (Chrome en Android), funciona sin conexión |
| Lenguaje | TypeScript |
| Tamaño del código | ≈ 6 000 líneas (TS + CSS + HTML) en 21 ficheros |
| Pruebas | 36 tests automáticos en 3 ficheros, todos superados |
| Publicación | GitHub Pages, despliegue automático con GitHub Actions |

---

## 2. Objetivos y alcance

### 2.1 Objetivos

1. Disponer de una calculadora cómoda en la tablet, con un teclado táctil tan agradable como el de Photomath.
2. Resolver con soltura los cálculos habituales de la carrera, con especial atención a **circuitos de alterna**: fasores (`10∠30°`), unidad imaginaria `j`, módulo, argumento, conjugado y `Z₁ ∥ Z₂`.
3. Mostrar el resultado **justo debajo de la expresión** y, bajo demanda, en **todas las notaciones** útiles, con la posibilidad de fijar cualquiera como predeterminada.
4. Ser de propósito general: ecuaciones, sistemas, cálculo, matrices y gráficas.
5. Funcionar sin internet y actualizarse sola.

### 2.2 Decisiones de alcance

| Incluido | Excluido a propósito |
|---|---|
| Teclado con las pestañas de Photomath (+−×÷ · f(x) e log ln · sin cos tan cot · lim dx ∫ Σ ∞) | Cámara para escanear ejercicios |
| Pestañas propias: matrices y ℂ ∠ fasores | Resolución paso a paso |
| Panel «Mostrar soluciones» con todas las notaciones | nPr / nCr / variaciones, binomial, signo |
| Sistemas de ecuaciones, gráficas 2D y superficies 3D | Subíndices, plantillas de llamada a función, listas |
| Lectura de fórmulas en imágenes (pegar / compartir) | Ángulos en grados-minutos-segundos y sucesiones (aₙ) |

Las funciones que faltan se añaden a medida que se echan en falta durante el uso, en lugar de anticiparlas.

---

## 3. Tecnologías

| Pieza | Uso |
|---|---|
| **TypeScript** | Todo el código de la aplicación y del motor |
| **Vite** | Servidor de desarrollo y compilación de producción |
| **MathLive** | Editor matemático (entrada en LaTeX con cursor táctil) |
| **math.js** | Aritmética de números complejos y funciones especiales |
| **vite-plugin-pwa + Workbox** | Manifiesto, precaché y *service worker* propio |
| **Vitest** | Pruebas del motor de cálculo |
| **@anthropic-ai/sdk** / API de Gemini | Reconocimiento de fórmulas en imágenes (opcional) |
| **GitHub Actions + GitHub Pages** | Integración continua y publicación |

No hay servidor propio: toda la lógica se ejecuta en el navegador de la tablet.

---

## 4. Arquitectura

La aplicación separa con claridad el **motor de cálculo**, que no sabe nada de la interfaz, de la **capa de interfaz**, que solo dibuja y gestiona la interacción.

```
LaTeX del editor (MathLive)
        │
        ▼
 parser.ts ──► árbol (Node)
        │
        ▼
 index.ts · calculate()  ── decide qué es la entrada
        │
        ├─ evaluate.ts   valor numérico (complejos)
        ├─ matrix.ts     valores matriciales
        ├─ calculus.ts   derivadas, integrales, límites, series
        ├─ solve.ts      ecuaciones de una incógnita
        ├─ realsolve.ts  sistemas, desigualdades, primitivas
        └─ symbolic.ts   derivación simbólica
        │
        ▼
 Result (value | matrix | solutions | system | inequality | function | …)
        │
        ▼
 format.ts ──► LaTeX formateado según los ajustes
        │
        ▼
 main.ts + ui/  (resultado, panel de soluciones, gráficas, historial)
```

### 4.1 Estructura de ficheros

```
src/
├── main.ts            Arranque, editor, resultado, historial, ajustes, gestos
├── ocr.ts             Lectura de fórmulas en imágenes (Gemini / Claude)
├── sw.ts              Service worker: precaché y recepción de «Compartir»
├── style.css          Estilos (adaptables al tamaño de la ventana)
├── engine/            Motor de cálculo, independiente de la interfaz
│   ├── parser.ts      LaTeX → árbol sintáctico
│   ├── evaluate.ts    Evaluación con números complejos
│   ├── index.ts       calculate(): clasifica y resuelve la entrada
│   ├── solve.ts       Ecuaciones y raíces de polinomios
│   ├── realsolve.ts   Sistemas, desigualdades, integración de polinomios
│   ├── calculus.ts    Derivadas, integrales numéricas, límites, series
│   ├── symbolic.ts    Derivadas simbólicas
│   ├── matrix.ts      Álgebra de matrices complejas
│   ├── format.ts      Notaciones y formato de salida
│   └── *.test.ts      Pruebas (engine, calculus, matrix)
└── ui/
    ├── keys.ts        Definición del teclado y sus pestañas
    ├── solutions.ts   Panel «Mostrar soluciones»
    ├── plot.ts        Gráficas 2D y diagrama fasorial
    └── surface.ts     Superficies 3D de f(x, y)
```

### 4.2 El motor de cálculo

- **Parser** (`parser.ts`). Convierte el LaTeX que produce MathLive en un árbol propio. Reconoce multiplicación implícita, fasores `r∠θ`, el operador paralelo `∥`, valor absoluto con barras, potencias, fracciones, raíces, matrices (`pmatrix`, `bmatrix`, `vmatrix` como determinante), integrales, derivadas, límites, sumatorios, sistemas (varias líneas) y relaciones `=`, `<`, `≤`…
- **Clasificación** (`index.ts`). `calculate()` decide qué representa la entrada y devuelve un `Result` tipado: un valor, una matriz, un polinomio, una ecuación con sus raíces, un sistema, una desigualdad, una definición de función para graficar, un booleano, una expresión simbólica o una petición de valores para variables libres.
- **Evaluación** (`evaluate.ts`). Todo se calcula en el cuerpo de los complejos, de modo que `√(−4)` o `ln(−1)` tienen respuesta. Respeta la unidad angular (grados o radianes) y avisa cuando se mezclan trigonometría en grados con cálculo.
- **Ecuaciones** (`solve.ts`, `realsolve.ts`). Los polinomios se resuelven por completo (raíces complejas incluidas, con multiplicidad); el resto, numéricamente. Los sistemas lineales se resuelven de forma exacta también con complejos (útil para análisis por mallas); los no lineales, por Newton. Las desigualdades se devuelven en notación de intervalos.
- **Cálculo** (`calculus.ts`, `symbolic.ts`). Derivadas simbólicas y numéricas, integrales definidas (también impropias) por cuadratura adaptativa, primitivas de polinomios, límites (laterales y en el infinito), sumatorios y productorios.
- **Matrices** (`matrix.ts`). Suma, producto, potencias, inversa, traspuesta, determinante, traza, rango, polinomio característico y valores propios, todo con entradas complejas.
- **Formato** (`format.ts`). Notación automática, fija, científica o de ingeniería; prefijos SI (`4,7 k`); fracciones; múltiplos de π; forma rectangular, polar o exponencial; coma o punto decimal; `i` o `j`.

### 4.3 La interfaz

- **Editor** MathLive con cursor táctil (tocar la expresión mueve el cursor) y menú al mantenerla pulsada: Deshacer, Pegar, Copiar y Borrar.
- **Teclado propio** (`ui/keys.ts`): fila de herramientas (abc, historial, pegar, ← →, ↵, ⌫) y pestañas temáticas. Las teclas con punto ofrecen alternativas al mantenerlas pulsadas y se eligen deslizando el dedo. En pantalla ancha se muestran a la vez funciones y números; en ventana estrecha el teclado se reorganiza usando unidades de contenedor.
- **Resultado** debajo de la expresión con una forma alternativa y el botón **Mostrar soluciones** (`ui/solutions.ts`), que enumera todas las notaciones y permite fijar cualquiera como predeterminada. Para matrices añade inversa, traspuesta y valores propios.
- **Gráficas** (`ui/plot.ts`, `ui/surface.ts`): funciones y ecuaciones en 2D con arrastre, pellizco y lectura de valores al tocar; curvas de los sistemas con sus puntos de corte; raíces complejas en el plano; diagrama fasorial; superficies 3D de `z = f(x, y)`.
- **Historial** automático y `Ans`.
- **Comportamiento en Android**: al minimizar o cambiar de ventana el editor pierde el foco y no se abre automáticamente al arrancar, para que no aparezca el teclado del sistema.

### 4.4 Lectura de fórmulas en imágenes

Una captura con una fórmula se puede **pegar** (tecla Pegar o menú contextual), **arrastrar** sobre la app o **compartir** desde cualquier aplicación de Android (la calculadora aparece en el menú «Compartir» gracias al `share_target` del manifiesto, que atiende `sw.ts`). La imagen se envía a **Gemini** (`gemini-3.5-flash`, nivel gratuito) o a **Claude** (`claude-opus-5-5`), que devuelven la fórmula en LaTeX para el editor.

Privacidad: la clave de API la introduce el usuario en *Ajustes → Leer fórmulas de imágenes* y se guarda **solo en la tablet** (`localStorage`). Las peticiones van directamente del navegador al proveedor, sin servidor intermedio.

### 4.5 PWA y publicación

- Manifiesto con nombre, iconos (incluido *maskable*), orientación libre y `share_target`.
- *Service worker* propio (estrategia `injectManifest`) que precachea toda la app: funciona sin conexión y se actualiza sola (`autoUpdate`).
- Cada subida a `main` ejecuta en GitHub Actions: `npm ci` → `npm test` → `npm run build` → publicación de `dist/` en GitHub Pages. Si un test falla, no se publica.
- Los commits usan la dirección *noreply* de GitHub para no exponer el correo personal.

---

## 5. Funcionalidades de la versión 1.0

| Área | Qué incluye |
|---|---|
| Aritmética | Operaciones, potencias, raíces, fracciones, factorial, porcentajes, constantes (π, e) |
| Funciones | Logaritmos, exponencial, trigonométricas e inversas, hiperbólicas, valor absoluto |
| Complejos y fasores | `j`/`i`, `r∠θ`, módulo, argumento, Re, Im, conjugado, `Z₁ ∥ Z₂`, forma rectangular/polar/exponencial |
| Ecuaciones | Una incógnita (todas las raíces de polinomios, también complejas), identidades |
| Sistemas | Varias líneas con ↵; lineales exactos con complejos, no lineales por Newton |
| Desigualdades | Solución en notación de intervalos |
| Cálculo | Derivadas simbólicas, integrales definidas e impropias, primitivas de polinomios, límites, Σ y Π |
| Matrices | +, ×, potencias, A⁻¹, Aᵀ, det, traza, rango, valores propios; filas y columnas desde el teclado |
| Gráficas | 2D interactivas, sistemas con cortes, raíces en el plano complejo, diagrama fasorial, superficies 3D |
| Salida | Notación automática/fija/científica/ingeniería, prefijos SI, fracciones, π, cifras y decimales configurables |
| Entrada | Teclado propio, cursor táctil, pegar y compartir imágenes con fórmulas, arrastrar y soltar |
| Uso | Historial, `Ans`, ajustes persistentes, modo ventana estrecha, funcionamiento sin conexión |

---

## 6. Calidad y pruebas

El motor está cubierto por **36 pruebas automáticas** (Vitest) repartidas en:

- `engine.test.ts` — parser, evaluación, complejos y fasores, ecuaciones, sistemas, desigualdades y formato.
- `calculus.test.ts` — derivadas, integrales, límites y series.
- `matrix.test.ts` — operaciones, determinante, inversa, rango y valores propios.

Además se comprueban los tipos (`npm run typecheck`) y la app se ha validado en el navegador durante el desarrollo y, durante varias semanas, en la tablet con uso real. La lectura de imágenes se verificó localmente con claves de prueba (ambos proveedores responden correctamente «clave no válida»).

---

## 7. Cronología

| Fecha | Hito |
|---|---|
| 17/10/2026 | Primera versión: editor, teclado tipo Photomath, resultado y panel de soluciones, complejos y fasores, ecuaciones, sistemas, desigualdades, cálculo, matrices y gráficas 2D/3D |
| 17/10/2026 | Teclado plano y adaptable, cursor táctil, alternativas al deslizar e historial en ventana pequeña |
| 17/10/2026 | Publicación en GitHub Pages con GitHub Actions; instrucciones de instalación en el README |
| 17/10/2026 | Lectura de fórmulas en imágenes (pegar, arrastrar, compartir), menú contextual, ⌫ que deshace líneas de sistemas y editor sin teclado de Android al volver |
| oct–nov 2026 | Periodo de uso y prueba en la tablet |
| 19/11/2026 | **Cierre de la Fase 1 — versión 1.0.0** |

---

## 8. Decisiones de diseño destacables

- **Motor propio sobre math.js** en lugar de usar `math.evaluate`: la entrada llega en LaTeX desde MathLive y necesita notaciones que math.js no entiende (∠, ∥, multiplicación implícita, sistemas en varias líneas).
- **Complejos en todo el motor**: evita casos especiales y hace que los circuitos de alterna sean ciudadanos de primera.
- **Resultado tipado** (`Result`): la interfaz decide cómo presentar cada tipo sin volver a analizar la expresión.
- **Táctil primero**: teclas grandes, alternativas al deslizar, gestos en gráficas y un diseño que no se rompe en pantalla dividida.
- **Sin servidor**: coste cero, funciona sin conexión y las claves de API nunca salen de la tablet salvo hacia su proveedor.

---

## 9. Limitaciones conocidas y propuestas para la Fase 2

Pendientes que quedaron fuera de la versión 1.0:

1. **Variables de matriz** (`A = …`) y ecuaciones matriciales.
2. **Ecuaciones diferenciales** (`dy/dx`, `y'`).
3. **Integrales indefinidas** más allá de los polinomios.
4. La lectura de imágenes depende de una clave de API propia y de conexión a internet.
5. Tras cambios en el manifiesto (por ejemplo el menú «Compartir»), Android puede requerir reinstalar la app para que se apliquen.

La Fase 2 seguirá el mismo criterio que la primera: añadir lo que se eche en falta durante el uso real.

---

## 10. Guía rápida de desarrollo

```bash
npm install
npm run dev         # servidor local, accesible desde la red Wi-Fi
npm test            # pruebas del motor
npm run typecheck   # comprobación de tipos
npm run build       # versión de producción en dist/
npm run preview     # sirve dist/ para probar en la tablet (http://<IP-del-PC>:4173)
```

**Instalar en la tablet**: abrir <https://miguelcosme2343.github.io/Calculadora/> en Chrome → menú ⋮ → *Instalar aplicación*. Una vez instalada funciona sin internet y se actualiza sola al publicar una versión nueva.
