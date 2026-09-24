# Política de segurança

## Reportando uma vulnerabilidade

Se você encontrar uma falha de segurança neste projeto, **não abra uma issue pública**.
Use a aba **[Security → Report a vulnerability](https://github.com/LuisGuilherme605/Teste/security/advisories/new)**
deste repositório (GitHub Security Advisories), que cria um relato privado visível só para os
mantenedores até haver correção.

Sem acesso à aba Security, mande um e-mail para o endereço do autor listado em
[`package.json`](package.json), com o assunto `[security] prospecto`.

Inclua, na medida do possível:

- Passos para reproduzir
- Versão/commit afetado
- Impacto que você identificou (o que um atacante ganha)

Não há prazo formal de SLA — este é um projeto pessoal mantido fora de horário
comercial — mas relatos de segurança têm prioridade sobre qualquer outra coisa aberta no
momento.

## Escopo

Este é um projeto de código aberto de uso geral, não um serviço com contrato de
disponibilidade. Ele **não passou por auditoria de segurança formal**. Antes de usar em
produção com dados reais, revise o código você mesmo — em especial `src/server/`, que
concentra autenticação e superfície HTTP.

## O que já está tratado, e por quê

Documentado com mais contexto no [README](README.md#segurança) e em
[`docs/deploy.md`](docs/deploy.md#segurança); resumo:

| Risco | Mitigação |
|---|---|
| Publicar exposto sem senha | O servidor se recusa a iniciar em interface pública sem `PROSPECTO_SENHA` |
| Força bruta na senha | Limite de tentativas por IP, com atraso progressivo |
| Comparação de senha vazando por tempo | `timingSafeEqual`, nunca `===` |
| Roubo de sessão via XSS | Cookie `HttpOnly`; CSP sem `unsafe-inline` em script |
| CSRF | Cookie `SameSite=Strict` |
| Interceptação em trânsito | Cookie `Secure` sob HTTPS; guias de deploy configuram TLS por padrão |
| Vazamento de detalhe de implementação em erro 500 | Mensagem genérica ao cliente; detalhe só no log do servidor |
| Travessia de diretório nos arquivos estáticos | Caminho resolvido e validado contra a raiz pública antes de servir |

## O que está fora do escopo atual

- **Sem usuários individuais.** A autenticação é uma senha compartilhada por sessão
  assinada. Não há papéis, permissões por usuário nem trilha de auditoria de quem fez
  o quê — se isso importa para o seu uso, é um ponto para resolver antes de publicar
  com dados sensíveis de verdade.
- **Sem criptografia em repouso.** O banco SQLite fica em texto simples no disco. Quem
  tem acesso ao servidor lê os dados.
- **Dependência de terceiros no runtime: zero.** É proposital — elimina uma classe
  inteira de risco de cadeia de suprimentos (pacote comprometido, typosquatting). O
  `CI` falha se `dependencies`/`devDependencies` deixarem de estar vazios.

## Versões suportadas

Não há branches de manutenção paralelas. Correções de segurança vão para a branch
principal; use sempre a versão mais recente.
