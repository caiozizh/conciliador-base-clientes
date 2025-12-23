# Conciliador Base de Clientes

Aplicação para confrontar bases de clientes (Questor, Sênior e Gestta), identificar divergências e gerar auditoria de ações. Esta versão roda 100% local no navegador (sem Firebase), usando `localStorage`.

## Requisitos

- Node.js 18+ (recomendado)
- npm

## Como subir localmente

1) Instale dependências:
```
npm install
```

2) Rode o servidor de desenvolvimento:
```
npm run dev
```

3) Abra a URL exibida no terminal (geralmente `http://localhost:5173`).

## Fluxo de uso

1) **Login simples**: informe seu nome para entrar (sem senha).
2) **Importar bases**: na aba **Importar**, carregue arquivos:
   - Questor: `.txt` ou `.csv` com separador `|` (pipe) ou `.xlsx`
   - Sênior: `.csv` ou `.xlsx`
   - Gestta: `.csv` ou `.xlsx`
3) **Trabalho**: use filtros, busca e ordenação para encontrar divergências.
4) **Auditoria**: veja o histórico de ações registradas localmente.

## Funções principais

- **Consolidação de bases**: cruza Questor, Sênior e Gestta por CNPJ.
- **Diagnóstico automático**: classifica como Consistente, Divergente, Falta Cadastro Questor ou Cliente Inativo (Baixa).
- **Regra de matriz**: considera a regra de 8 dígitos e permite ignorar/reativar por cliente.
- **Vínculo de pagador**: vincula manualmente pagadores para casos específicos.
- **Confronto de espécie**: lê o sufixo do nome do Gestta `#0` ou `#1` e compara com `ESPECIEESTAB` do Questor:
  - `#0` → esperado **IN COMPANY**
  - `#1` → esperado **INTEGRADA**
- **Exportação CSV**: exporta a visão filtrada.
- **Auditoria local**: registra login, importação, vínculos e limpezas no `localStorage`.

## Armazenamento local

Todos os dados ficam no navegador (localStorage). Se quiser reiniciar do zero, limpe o storage do site no DevTools do browser.

## Observações de importação

- CSV/TXT com encoding ANSI/Windows-1252 são convertidos automaticamente.
- Para melhores resultados, use arquivos limpos sem colunas duplicadas.

## Scripts

- `npm run dev`: ambiente de desenvolvimento
- `npm run build`: build de produção
- `npm run preview`: pré-visualização do build

