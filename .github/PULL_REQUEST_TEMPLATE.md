## O que muda e por quê

<!-- Não só "o que" — o problema que motivou a mudança. -->

## Como testar

<!-- Passos para quem revisa validar localmente. -->

## Checklist

- [ ] `npm test` passa localmente
- [ ] Testei o comportamento manualmente (`npm run demo` ou `npm start`)
- [ ] Não adicionei dependência nova em `dependencies`/`devDependencies`
- [ ] Se mudei comportamento existente, atualizei os testes que cobrem esse comportamento
- [ ] Se mudei algo em `src/server/` (autenticação, rotas), revisei [`SECURITY.md`](../SECURITY.md) para ver se algo ali precisa de atualização
