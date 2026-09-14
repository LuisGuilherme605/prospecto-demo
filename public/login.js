/**
 * Tela de login.
 *
 * O unico trabalho aqui e trocar a senha por um cookie de sessao. O token nunca
 * passa por JavaScript: o servidor o devolve como cookie HttpOnly, justamente
 * para que um XSS nao consiga le-lo.
 */

const form = document.querySelector('#form-login');
const campoSenha = document.querySelector('#senha');
const botao = document.querySelector('#btn-entrar');
const erro = document.querySelector('#erro');

try {
  const tema = localStorage.getItem('prospecto:tema');
  if (tema) document.documentElement.dataset.tema = tema;
} catch { /* sem preferencia salva */ }

/** Volta para a pagina pedida, recusando destino externo (open redirect). */
function destinoSeguro() {
  const bruto = new URLSearchParams(location.search).get('destino');
  if (!bruto) return '/';
  // So caminho interno: "//evil.com" e "https://evil.com" sao rejeitados.
  if (!bruto.startsWith('/') || bruto.startsWith('//')) return '/';
  return bruto;
}

function mostrarErro(mensagem) {
  erro.textContent = mensagem;
  erro.hidden = false;
  campoSenha.select();
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  erro.hidden = true;
  botao.disabled = true;
  botao.textContent = 'Entrando...';

  try {
    const resposta = await fetch('/api/sessao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: campoSenha.value }),
    });

    if (resposta.ok) {
      location.replace(destinoSeguro());
      return;
    }

    const dados = await resposta.json().catch(() => ({}));
    mostrarErro(dados.erro ?? 'Nao foi possivel entrar. Tente de novo.');
  } catch {
    mostrarErro('Sem conexao com o servidor.');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});
