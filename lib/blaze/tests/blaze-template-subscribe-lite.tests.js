import { assert } from "chai";
import { Blaze } from "meteor/blaze";

describe("Blaze Template instances", function () {
  let renderedView;

  after(function () {
    Blaze.remove(renderedView);
  });

  it("should have subscribeLite defined", function () {
    const template = new Blaze.Template(() => null);
    template.onCreated(function () {
      assert.isFunction(this.subscribeLite);
    });
    renderedView = Blaze.render(template, document.body);
  });
});
