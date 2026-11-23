import { createTask, localDay } from './task.js';

const examples = [
  ['Planejar identidade visual', 'Definir paleta, tipografia e referências para o microsite.', 'done', 'high', -4, 'Design', ['marca']],
  ['Desenvolver página inicial', 'Montar a estrutura da página e criar os componentes reutilizáveis.', 'in_progress', 'high', 2, 'Desenvolvimento', ['frontend']],
  ['Implementar formulário', 'Validar os campos e testar mensagens de erro e sucesso.', 'in_progress', 'urgent', -1, 'Desenvolvimento', ['frontend', 'formulário']],
  ['Revisar responsividade', 'Revisar as páginas principais em celular, tablet e desktop.', 'todo', 'medium', 5, 'Qualidade', ['mobile']],
  ['Executar testes', 'Verificar a navegação por teclado e os principais fluxos.', 'todo', 'medium', 6, 'Qualidade', ['QA']],
  ['Publicar versão final', 'Preparar os arquivos estáticos e revisar o checklist de entrega.', 'todo', 'low', 9, 'Entrega', ['publicação']],
  ['Organizar referências', 'Reunir as referências aprovadas para a apresentação inicial.', 'done', 'low', -7, 'Design', ['pesquisa']],
  ['Revisar conteúdo', 'Alinhar os textos e revisar os títulos do microsite.', 'todo', 'medium', 3, 'Conteúdo', ['editorial']],
];

export function makeDemo(now = new Date()) {
  const tasks = [];
  for (const [title, description, status, priority, offset, category, tags] of examples) {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    tasks.push(createTask(tasks, { title, description, status, priority, dueDate: localDay(date), category, tags: [...tags, 'exemplo'] }, undefined, now));
  }
  return tasks;
}
